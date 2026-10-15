import type { Manifest, ManifestRoute } from '@mokup/runtime'
import type { BuildOptions, RouteDirectoryConfig, RouteRule } from './types'

import { promises as fs } from 'node:fs'
import { cwd } from 'node:process'

import { createRouteDiagnosticSections } from '@mokup/shared/diagnostics'
import { join, relative, resolve } from '@mokup/shared/pathe'
import { resolveDirectoryConfig } from './config'
import {
  collectFiles,
  hasIgnoredPrefix,
  isSupportedFile,
  matchesFilter,
  normalizeIgnorePrefix,
  resolveDirs,
} from './files'
import { buildResponse, getHandlerModulePath } from './handlers'
import { deriveRouteFromFile, resolveRule, sortRoutes } from './routes'
import { loadRules } from './rules'
import { toPosix } from './utils'

/** Prepare routes and build metadata without writing output artifacts. */
export async function scanManifest(options: BuildOptions = {}, strictInputs = false) {
  const root = options.root ?? cwd()
  const outDir = resolve(root, options.outDir ?? '.mokup')
  const handlersDir = join(outDir, 'mokup-handlers')
  const dirs = resolveDirs(options.dir, root)

  if (strictInputs) {
    for (const dir of dirs) {
      const displayPath = toPosix(relative(root, dir)) || '.'
      let stat
      try {
        stat = await fs.stat(dir)
      }
      catch (error) {
        throw new Error(`Cannot read mock directory "${displayPath}": ${String(error)}`, { cause: error })
      }
      if (!stat.isDirectory()) {
        throw new Error(`Mock path is not a directory: ${displayPath}`)
      }
    }
  }

  const files = await collectFiles(dirs)
  const routes: ManifestRoute[] = []
  const seen = new Set<string>()
  const handlerSources = new Set<string>()
  const handlerModuleMap = new Map<string, string>()
  const configCache = new Map<string, RouteDirectoryConfig | null>()
  const configFileCache = new Map<string, string | null>()
  const globalIgnorePrefix = normalizeIgnorePrefix(options.ignorePrefix)
  const invalidRouteFiles = new Set<string>()
  const unsupportedRuleFiles = new Set<string>()
  const missingHandlerFiles = new Set<string>()
  const duplicateRoutes = new Set<string>()

  for (const fileInfo of files) {
    const configParams: Parameters<typeof resolveDirectoryConfig>[0] = {
      file: fileInfo.file,
      rootDir: fileInfo.rootDir,
      configCache,
      fileCache: configFileCache,
    }
    if (options.log) {
      configParams.log = options.log
    }
    const config = await resolveDirectoryConfig(configParams)
    if (config.enabled === false) {
      continue
    }
    const effectiveIgnorePrefix = typeof config.ignorePrefix !== 'undefined'
      ? normalizeIgnorePrefix(config.ignorePrefix, [])
      : globalIgnorePrefix
    if (hasIgnoredPrefix(fileInfo.file, fileInfo.rootDir, effectiveIgnorePrefix)) {
      continue
    }
    if (!isSupportedFile(fileInfo.file)) {
      continue
    }
    const effectiveInclude = typeof config.include !== 'undefined'
      ? config.include
      : options.include
    const effectiveExclude = typeof config.exclude !== 'undefined'
      ? config.exclude
      : options.exclude
    if (!matchesFilter(fileInfo.file, effectiveInclude, effectiveExclude)) {
      continue
    }
    const derived = deriveRouteFromFile(fileInfo.file, fileInfo.rootDir, options.log)
    if (!derived) {
      invalidRouteFiles.add(toPosix(relative(root, fileInfo.file)))
      continue
    }
    const rules = await loadRules(fileInfo.file, { strict: strictInputs })
    for (const [index, rule] of rules.entries()) {
      if (!rule || typeof rule !== 'object') {
        continue
      }
      if (rule.enabled === false) {
        continue
      }
      const ruleValue = rule as unknown as Record<string, unknown>
      const unsupportedKeys = ['response', 'url', 'method'].filter(
        key => key in ruleValue,
      )
      if (unsupportedKeys.length > 0) {
        unsupportedRuleFiles.add(toPosix(relative(root, fileInfo.file)))
        options.log?.(
          `Skip mock with unsupported fields (${unsupportedKeys.join(', ')}): ${fileInfo.file}`,
        )
        continue
      }
      if (typeof rule.handler === 'undefined') {
        missingHandlerFiles.add(toPosix(relative(root, fileInfo.file)))
        options.log?.(`Skip mock without handler: ${fileInfo.file}`)
        continue
      }
      const resolveParams: {
        rule: RouteRule
        derivedTemplate: string
        derivedMethod: ManifestRoute['method']
        prefix: string
        file: string
        log?: (message: string) => void
      } = {
        rule,
        derivedTemplate: derived.template,
        derivedMethod: derived.method,
        prefix: options.prefix ?? '',
        file: fileInfo.file,
      }
      if (options.log) {
        resolveParams.log = options.log
      }
      const resolved = resolveRule(resolveParams)
      if (!resolved) {
        if (strictInputs) {
          invalidRouteFiles.add(toPosix(relative(root, fileInfo.file)))
        }
        continue
      }
      const key = `${resolved.method} ${resolved.template}`
      if (seen.has(key)) {
        duplicateRoutes.add(key)
        options.log?.(`Duplicate mock route ${key} from ${fileInfo.file}`)
      }
      seen.add(key)
      const response = buildResponse(
        rule.handler,
        {
          file: fileInfo.file,
          handlers: options.handlers !== false,
          handlerSources,
          handlerModuleMap,
          handlersDir,
          root,
          ruleIndex: index,
        },
      )
      if (!response) {
        continue
      }
      const source = toPosix(relative(root, fileInfo.file))
      const middlewareRefs = options.handlers === false
        ? []
        : config.middlewares.map((entry) => {
            handlerSources.add(entry.file)
            const modulePath = getHandlerModulePath(entry.file, handlersDir, root)
            handlerModuleMap.set(entry.file, modulePath)
            return {
              module: modulePath,
              ruleIndex: entry.index,
            }
          })
      const route: ManifestRoute = {
        method: resolved.method,
        url: resolved.template,
        tokens: resolved.tokens,
        score: resolved.score,
        source,
        response,
      }
      if (typeof rule.status === 'number') {
        route.status = rule.status
      }
      if (config.headers) {
        route.headers = { ...config.headers }
      }
      if (rule.headers) {
        route.headers = { ...(route.headers ?? {}), ...rule.headers }
      }
      if (typeof rule.delay === 'number') {
        route.delay = rule.delay
      }
      if (typeof route.status === 'undefined' && typeof config.status === 'number') {
        route.status = config.status
      }
      if (typeof route.delay === 'undefined' && typeof config.delay === 'number') {
        route.delay = config.delay
      }
      if (middlewareRefs.length > 0) {
        route.middleware = middlewareRefs
      }
      routes.push(route)
    }
  }

  const manifest: Manifest = {
    version: 1,
    routes: sortRoutes(routes),
  }

  const diagnosticSections = createRouteDiagnosticSections({
    invalidRoutes: Array.from(invalidRouteFiles),
    unsupportedFields: Array.from(unsupportedRuleFiles),
    missingHandlers: Array.from(missingHandlerFiles),
    duplicateRoutes: Array.from(duplicateRoutes),
  })

  return {
    root,
    outDir,
    handlersDir,
    manifest,
    handlerSources,
    handlerModuleMap,
    diagnosticSections,
  }
}
