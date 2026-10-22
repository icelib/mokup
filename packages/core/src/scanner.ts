import type { PreviewServer, ViteDevServer } from 'vite'

import type {
  RouteConfigInfo,
  RouteDecisionStep,
  RouteIgnoreInfo,
  RouteSkipInfo,
} from './scanner-types'
import type { Logger, RouteDirectoryConfig, RouteTable } from './shared/types'
import { resolveDirectoryConfig } from './config'
import { loadRules } from './loader'
import { deriveRouteFromFile, resolveRule, sortRoutes } from './routes'
import { runRoutePrechecks } from './scanner-precheck'
import { buildSkipInfo, resolveSkipRoute } from './scanner-utils'
import { collectFiles, isConfigFile } from './shared/files'
import { normalizeIgnorePrefix } from './shared/utils'

export type {
  RouteConfigInfo,
  RouteDecisionStep,
  RouteEffectiveConfig,
  RouteIgnoreInfo,
  RouteIgnoreReason,
  RouteSkipInfo,
  RouteSkipReason,
} from './scanner-types'

/**
 * Scan directories for mock routes and build the route table.
 *
 * @param params - Scanner configuration.
 * @param params.dirs - Directories to scan.
 * @param params.prefix - URL prefix to apply.
 * @param params.include - Include filters for files.
 * @param params.exclude - Exclude filters for files.
 * @param params.ignorePrefix - Ignored file/folder prefixes.
 * @param params.server - Optional dev/preview server.
 * @param params.logger - Logger for warnings.
 * @param params.onSkip - Optional skip callback.
 * @param params.onIgnore - Optional ignore callback.
 * @param params.onConfig - Optional config callback.
 * @returns The resolved route table.
 *
 * @example
 * import { scanRoutes } from 'mokup/vite'
 *
 * const routes = await scanRoutes({
 *   dirs: ['/project/mock'],
 *   prefix: '/api',
 *   logger: console,
 * })
 */
export async function scanRoutes(params: {
  dirs: string[]
  prefix: string
  include?: RegExp | RegExp[]
  exclude?: RegExp | RegExp[]
  ignorePrefix?: string | string[]
  server?: ViteDevServer | PreviewServer
  logger: Logger
  onSkip?: (info: RouteSkipInfo) => void
  onIgnore?: (info: RouteIgnoreInfo) => void
  onConfig?: (info: RouteConfigInfo) => void
}): Promise<RouteTable> {
  const routes: RouteTable = []
  const seen = new Map<string, { file: string, composable: boolean }>()
  const files = await collectFiles(params.dirs)
  const globalIgnorePrefix = normalizeIgnorePrefix(params.ignorePrefix)
  const configCache = new Map<string, RouteDirectoryConfig | null>()
  const fileCache = new Map<string, string | null>()
  const shouldCollectSkip = typeof params.onSkip === 'function'
  const shouldCollectIgnore = typeof params.onIgnore === 'function'
  const shouldCollectConfig = typeof params.onConfig === 'function'
  for (const fileInfo of files) {
    if (isConfigFile(fileInfo.file)) {
      if (shouldCollectConfig) {
        const configParams: Parameters<typeof resolveDirectoryConfig>[0] = {
          file: fileInfo.file,
          rootDir: fileInfo.rootDir,
          logger: params.logger,
          configCache,
          fileCache,
        }
        if (params.server) {
          configParams.server = params.server
        }
        const config = await resolveDirectoryConfig(configParams)
        params.onConfig?.({ file: fileInfo.file, enabled: config.enabled !== false })
      }
      continue
    }
    const configParams: Parameters<typeof resolveDirectoryConfig>[0] = {
      file: fileInfo.file,
      rootDir: fileInfo.rootDir,
      logger: params.logger,
      configCache,
      fileCache,
    }
    if (params.server) {
      configParams.server = params.server
    }
    const config = await resolveDirectoryConfig(configParams)
    const configChain = config.configChain ?? []
    const precheckParams: Parameters<typeof runRoutePrechecks>[0] = {
      fileInfo,
      prefix: params.prefix,
      config,
      configChain,
      globalIgnorePrefix,
      shouldCollectSkip,
      shouldCollectIgnore,
    }
    if (params.onSkip) {
      precheckParams.onSkip = params.onSkip
    }
    if (params.onIgnore) {
      precheckParams.onIgnore = params.onIgnore
    }
    if (params.include) {
      precheckParams.include = params.include
    }
    if (params.exclude) {
      precheckParams.exclude = params.exclude
    }
    const precheck = runRoutePrechecks(precheckParams)
    if (!precheck) {
      continue
    }
    const { decisionChain, effectiveConfigValue } = precheck
    const derived = deriveRouteFromFile(fileInfo.file, fileInfo.rootDir, params.logger)
    if (!derived) {
      if (shouldCollectIgnore) {
        decisionChain.push({
          step: 'route.derived',
          result: 'fail',
          source: fileInfo.file,
          detail: 'invalid route name',
        })
        const ignoreInfo: RouteIgnoreInfo = {
          file: fileInfo.file,
          reason: 'invalid-route',
          configChain,
          decisionChain,
        }
        if (effectiveConfigValue) {
          ignoreInfo.effectiveConfig = effectiveConfigValue
        }
        params.onIgnore?.(ignoreInfo)
      }
      continue
    }
    decisionChain.push({
      step: 'route.derived',
      result: 'pass',
      source: fileInfo.file,
    })
    const rules = await loadRules(fileInfo.file, params.server, params.logger)
    for (const [index, rule] of rules.entries()) {
      if (!rule || typeof rule !== 'object') {
        continue
      }
      if (rule.enabled === false) {
        if (shouldCollectSkip) {
          const resolved = resolveSkipRoute({
            file: fileInfo.file,
            rootDir: fileInfo.rootDir,
            prefix: params.prefix,
            derived,
          })
          const ruleDecisionStep: RouteDecisionStep = {
            step: 'rule.enabled',
            result: 'fail',
            source: fileInfo.file,
            detail: 'enabled=false',
          }
          const ruleDecisionChain = [...decisionChain, ruleDecisionStep]
          params.onSkip?.(buildSkipInfo(
            fileInfo.file,
            'disabled',
            resolved,
            configChain,
            ruleDecisionChain,
            effectiveConfigValue,
          ))
        }
        continue
      }
      const ruleValue = rule as unknown as Record<string, unknown>
      const unsupportedKeys = ['response', 'url', 'method'].filter(
        key => key in ruleValue,
      )
      if (unsupportedKeys.length > 0) {
        params.logger.warn(
          `Skip mock with unsupported fields (${unsupportedKeys.join(', ')}): ${fileInfo.file}`,
        )
        continue
      }
      if (typeof rule.handler === 'undefined') {
        params.logger.warn(`Skip mock without handler: ${fileInfo.file}`)
        continue
      }
      const resolved = resolveRule({
        rule,
        derivedTemplate: derived.template,
        derivedMethod: derived.method,
        prefix: params.prefix,
        file: fileInfo.file,
        logger: params.logger,
      })
      if (!resolved) {
        continue
      }
      resolved.ruleIndex = index
      if (configChain.length > 0) {
        resolved.configChain = configChain
      }
      if (config.headers) {
        resolved.headers = { ...config.headers, ...(resolved.headers ?? {}) }
      }
      if (typeof resolved.status === 'undefined' && typeof config.status === 'number') {
        resolved.status = config.status
      }
      if (typeof resolved.delay === 'undefined' && typeof config.delay === 'number') {
        resolved.delay = config.delay
      }
      if (config.middlewares.length > 0) {
        resolved.middlewares = config.middlewares
      }
      const key = `${resolved.method} ${resolved.template}`
      const previous = seen.get(key)
      if (previous && (previous.file !== fileInfo.file || !previous.composable)) {
        params.logger.warn(`Duplicate mock route ${key} from ${fileInfo.file}`)
      }
      seen.set(key, { file: fileInfo.file, composable: rule.once === true || rule.handlerType === 'http' })
      routes.push(resolved)
    }
  }
  return sortRoutes(routes)
}
