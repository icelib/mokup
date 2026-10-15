import type {
  Logger,
  RouteTable,
  VitePluginOptions,
} from './shared/types'

import { buildManifestData, toViteImportPath } from './manifest'
import { normalizePrefix } from './shared/utils'
import { createRuntimeRuleHelpers } from './sw-script-snippets'

/**
 * Default service worker script path.
 *
 * @example
 * import { defaultSwPath } from 'mokup/vite'
 *
 * const path = defaultSwPath
 */
export const defaultSwPath = '/mokup-sw.js'
/**
 * Default service worker scope.
 *
 * @example
 * import { defaultSwScope } from 'mokup/vite'
 *
 * const scope = defaultSwScope
 */
export const defaultSwScope = '/'

/**
 * Resolved service worker configuration.
 *
 * @example
 * import type { ResolvedSwConfig } from 'mokup/vite'
 *
 * const config: ResolvedSwConfig = {
 *   path: '/mokup-sw.js',
 *   scope: '/',
 *   register: true,
 *   unregister: false,
 *   basePaths: [],
 * }
 */
export interface ResolvedSwConfig {
  path: string
  scope: string
  register: boolean
  unregister: boolean
  basePaths: string[]
}

function normalizeSwPath(path: string) {
  if (!path) {
    return defaultSwPath
  }
  return path.startsWith('/') ? path : `/${path}`
}

function normalizeSwScope(scope: string) {
  if (!scope) {
    return defaultSwScope
  }
  return scope.startsWith('/') ? scope : `/${scope}`
}

function normalizeBasePath(value: string) {
  if (!value) {
    return '/'
  }
  const normalized = value.startsWith('/') ? value : `/${value}`
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1)
  }
  return normalized
}

function appendModuleVersion(modulePath: string, moduleVersion?: string | number) {
  if (typeof moduleVersion === 'undefined') {
    return modulePath
  }
  const hashIndex = modulePath.indexOf('#')
  const hash = hashIndex >= 0 ? modulePath.slice(hashIndex) : ''
  const basePath = hashIndex >= 0 ? modulePath.slice(0, hashIndex) : modulePath
  const separator = basePath.includes('?') ? '&' : '?'
  return `${basePath}${separator}mokupv=${encodeURIComponent(String(moduleVersion))}${hash}`
}

function resolveSwConfigFromEntries(
  entries: VitePluginOptions[],
  logger: Logger,
): ResolvedSwConfig {
  let path = defaultSwPath
  let scope = defaultSwScope
  let register = true
  let unregister = false
  const basePaths: string[] = []
  let hasPath = false
  let hasScope = false
  let hasRegister = false
  let hasUnregister = false

  for (const entry of entries) {
    const config = entry.sw
    if (config?.path) {
      const next = normalizeSwPath(config.path)
      if (!hasPath) {
        path = next
        hasPath = true
      }
      else if (path !== next) {
        logger.warn(`SW path "${next}" ignored; using "${path}".`)
      }
    }
    if (config?.scope) {
      const next = normalizeSwScope(config.scope)
      if (!hasScope) {
        scope = next
        hasScope = true
      }
      else if (scope !== next) {
        logger.warn(`SW scope "${next}" ignored; using "${scope}".`)
      }
    }
    if (typeof config?.register === 'boolean') {
      if (!hasRegister) {
        register = config.register
        hasRegister = true
      }
      else if (register !== config.register) {
        logger.warn(
          `SW register="${String(config.register)}" ignored; using "${String(register)}".`,
        )
      }
    }
    if (typeof config?.unregister === 'boolean') {
      if (!hasUnregister) {
        unregister = config.unregister
        hasUnregister = true
      }
      else if (unregister !== config.unregister) {
        logger.warn(
          `SW unregister="${String(config.unregister)}" ignored; using "${String(unregister)}".`,
        )
      }
    }

    if (typeof config?.basePath !== 'undefined') {
      const values = Array.isArray(config.basePath)
        ? config.basePath
        : [config.basePath]
      for (const value of values) {
        basePaths.push(normalizeBasePath(value))
      }
      continue
    }
    const normalizedPrefix = normalizePrefix(entry.prefix ?? '')
    if (normalizedPrefix) {
      basePaths.push(normalizedPrefix)
    }
  }

  return {
    path,
    scope,
    register,
    unregister,
    basePaths: Array.from(new Set(basePaths)),
  }
}

/**
 * Resolve the service worker config from entries with mode "sw".
 *
 * @param options - Vite plugin options.
 * @param logger - Logger for warnings.
 * @returns Resolved config or null when no SW entries exist.
 *
 * @example
 * import { resolveSwConfig } from 'mokup/vite'
 *
 * const config = resolveSwConfig([], console)
 */
export function resolveSwConfig(
  options: VitePluginOptions[],
  logger: Logger,
): ResolvedSwConfig | null {
  const swEntries = options.filter(entry => entry.mode === 'sw')
  if (swEntries.length === 0) {
    return null
  }
  return resolveSwConfigFromEntries(swEntries, logger)
}

/**
 * Resolve SW config for unregister flow (all entries).
 *
 * @param options - Vite plugin options.
 * @param logger - Logger for warnings.
 * @returns Resolved config for unregister script.
 *
 * @example
 * import { resolveSwUnregisterConfig } from 'mokup/vite'
 *
 * const config = resolveSwUnregisterConfig([], console)
 */
export function resolveSwUnregisterConfig(
  options: VitePluginOptions[],
  logger: Logger,
): ResolvedSwConfig {
  return resolveSwConfigFromEntries(options, logger)
}

/**
 * Build the service worker script for mock routing.
 *
 * @param params - Script build inputs.
 * @param params.routes - Resolved routes to serialize.
 * @param params.root - Workspace root path.
 * @param params.runtimeImportPath - Runtime import override.
 * @param params.loggerImportPath - Logger import override.
 * @param params.basePaths - Base paths for SW matching.
 * @param params.moduleVersion - Optional version appended to SW module imports.
 * @param params.resolveModulePath - Optional module resolver.
 * @returns JavaScript source string.
 *
 * @example
 * import { buildSwScript } from 'mokup/vite'
 *
 * const script = buildSwScript({ routes: [], root: process.cwd() })
 */
export function buildSwScript(params: {
  routes: RouteTable
  root: string
  runtimeImportPath?: string
  loggerImportPath?: string
  basePaths?: string[]
  moduleVersion?: string | number
  resolveModulePath?: (file: string, root: string) => string
}) {
  const { routes, root } = params
  const runtimeImportPath = params.runtimeImportPath ?? 'mokup/runtime'
  const loggerImportPath = params.loggerImportPath ?? '@mokup/shared/logger'
  const basePaths = params.basePaths ?? []
  const resolveModulePath = params.resolveModulePath ?? toViteImportPath
  const moduleVersion = params.moduleVersion
  const resolveVersionedModulePath = (file: string, routeRoot: string) => {
    const modulePath = resolveModulePath(file, routeRoot)
    return appendModuleVersion(modulePath, moduleVersion)
  }
  const { manifest, modules } = buildManifestData({
    routes,
    root,
    resolveModulePath: resolveVersionedModulePath,
  })

  const imports: string[] = [
    `import { createLogger } from ${JSON.stringify(loggerImportPath)}`,
    `import { createRuntimeApp, handle } from ${JSON.stringify(runtimeImportPath)}`,
  ]
  const moduleEntries: Array<{ id: string, name: string, kind: 'rule' | 'middleware' }> = []
  let moduleIndex = 0

  for (const entry of modules) {
    const name = `module${moduleIndex++}`
    imports.push(`import * as ${name} from ${JSON.stringify(entry.id)}`)
    moduleEntries.push({ id: entry.id, name, kind: entry.kind })
  }

  const lines: string[] = []
  lines.push(...imports, '')
  lines.push(
    'const logger = createLogger()',
  )
  lines.push(...createRuntimeRuleHelpers(), '')
  lines.push(
    `const manifest = ${JSON.stringify(manifest, null, 2)}`,
    '',
  )

  if (moduleEntries.length > 0) {
    lines.push('const moduleMap = {')
    for (const entry of moduleEntries) {
      if (entry.kind === 'rule') {
        lines.push(
          `  ${JSON.stringify(entry.id)}: { default: toRuntimeRules(resolveModuleExport(${entry.name})) },`,
        )
        continue
      }
      lines.push(
        `  ${JSON.stringify(entry.id)}: ${entry.name},`,
      )
    }
    lines.push('}', '')
  }

  const runtimeOptions = moduleEntries.length > 0
    ? '{ manifest, moduleMap }'
    : '{ manifest }'

  lines.push(
    `const basePaths = ${JSON.stringify(basePaths)}`,
    '',
    'self.addEventListener(\'install\', () => {',
    '  self.skipWaiting()',
    '})',
    '',
    'self.addEventListener(\'activate\', (event) => {',
    '  event.waitUntil(self.clients.claim())',
    '})',
    '',
    'const shouldHandle = (request) => {',
    '  if (!basePaths || basePaths.length === 0) {',
    '    return true',
    '  }',
    '  const pathname = new URL(request.url).pathname',
    '  return basePaths.some((basePath) => {',
    '    if (basePath === \'/\') {',
    '      return true',
    '    }',
    '    return pathname === basePath || pathname.startsWith(basePath + \'/\')',
    '  })',
    '}',
    '',
    `const appPromise = createRuntimeApp(${runtimeOptions})`,
    'const app = {',
    '  fetch: (request, env, executionCtx) => appPromise.then((resolved) => resolved.fetch(request, env, executionCtx)),',
    '}',
    'const handler = handle(app)',
    '',
    'self.addEventListener(\'fetch\', (event) => {',
    '  if (!shouldHandle(event.request)) {',
    '    return',
    '  }',
    '  handler(event)',
    '})',
    '',
    'appPromise.catch((error) => {',
    '  logger.error(\'Failed to build service worker app:\', error)',
    '})',
    '',
  )

  return lines.join('\n')
}
