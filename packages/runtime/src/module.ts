import type {
  ManifestModuleRef,
  ManifestResponse,
  MiddlewareHandler,
  ModuleMap,
  RequestHandler,
} from './types'

/**
 * Normalized rule for module-based handlers.
 *
 * @example
 * import type { RuntimeRule } from '@mokup/runtime'
 *
 * const rule: RuntimeRule = {
 *   handler: () => ({ ok: true }),
 *   status: 200,
 * }
 */
export interface RuntimeRule {
  /** Native Fetch authoring is explicit; existing files default to Hono. */
  handlerType?: 'hono' | 'http'
  /** Consumption belongs to each mock session. */
  once?: boolean
  /** Handler value or function exported from a module. */
  handler?: unknown
  /**
   * Override status code for this rule.
   *
   * @default 200
   */
  status?: number
  /**
   * Additional response headers.
   *
   * @default {}
   */
  headers?: Record<string, string>
  /**
   * Delay in milliseconds before responding.
   *
   * @default 0
   */
  delay?: number
}

const URL_PROTOCOL_RE = /^(?:data|http|https|file):/

/**
 * Resolve a module path relative to a base directory or URL.
 *
 * @param modulePath - Module path from the manifest.
 * @param moduleBase - Base path or URL for relative modules.
 * @returns A fully qualified module URL or path.
 *
 * @example
 * import { resolveModuleUrl } from '@mokup/runtime'
 *
 * const url = resolveModuleUrl('./handlers/ping.mjs', new URL('file:///app/'))
 */
export function resolveModuleUrl(modulePath: string, moduleBase?: string | URL) {
  if (URL_PROTOCOL_RE.test(modulePath)) {
    return modulePath
  }
  if (!moduleBase) {
    throw new Error('moduleBase is required for relative module paths.')
  }
  const base = typeof moduleBase === 'string' ? moduleBase : moduleBase.href
  if (URL_PROTOCOL_RE.test(base)) {
    return new URL(modulePath, base).href
  }
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const normalizedModule = modulePath.startsWith('./')
    ? modulePath.slice(2)
    : modulePath.startsWith('/')
      ? modulePath.slice(1)
      : modulePath
  return `${normalizedBase}${normalizedModule}`
}

/**
 * Normalize a module export into an array of runtime rules.
 *
 * @param value - Exported module value.
 * @returns A list of runtime rules.
 *
 * @example
 * import { normalizeRules } from '@mokup/runtime'
 *
 * const rules = normalizeRules(() => ({ ok: true }))
 */
export function normalizeRules(value: unknown): RuntimeRule[] {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value as RuntimeRule[]
  }
  if (typeof value === 'function') {
    return [
      {
        handler: value,
      },
    ]
  }
  if (typeof value === 'object') {
    return [value as RuntimeRule]
  }
  return [
    {
      handler: value,
    },
  ]
}

/**
 * Execute a runtime rule and return its value.
 *
 * @param rule - Normalized runtime rule.
 * @param context - Request context.
 * @returns The handler result or static value.
 *
 * @example
 * import { executeRule } from '@mokup/runtime'
 *
 * const result = await executeRule({ handler: () => 'ok' }, {} as any)
 */
export async function executeRule(
  rule: RuntimeRule | undefined,
  context: Parameters<RequestHandler>[0],
) {
  if (!rule) {
    return undefined
  }
  const value = rule.handler
  if (typeof value === 'function') {
    const handler = value as RequestHandler
    return handler(context)
  }
  return value
}

function extractMiddlewareSource(value: unknown) {
  if (value && typeof value === 'object' && 'middleware' in value) {
    return (value as { middleware?: unknown }).middleware
  }
  return value
}

function normalizeMiddleware(value: unknown): MiddlewareHandler[] {
  const resolved = extractMiddlewareSource(value)
  if (!resolved) {
    return []
  }
  if (Array.isArray(resolved)) {
    return resolved.filter((entry): entry is MiddlewareHandler => typeof entry === 'function')
  }
  if (typeof resolved === 'function') {
    return [resolved as MiddlewareHandler]
  }
  return []
}

async function loadModuleExport(
  modulePath: string,
  exportName: string,
  moduleBase?: string | URL,
  moduleMap?: ModuleMap,
) {
  const directMapValue = moduleMap?.[modulePath]
  const resolvedUrl = directMapValue
    ? undefined
    : resolveModuleUrl(modulePath, moduleBase)
  const resolvedMapValue = resolvedUrl ? moduleMap?.[resolvedUrl] : undefined
  const moduleValue = directMapValue ?? resolvedMapValue
  const target = resolvedUrl ?? modulePath
  const module = moduleValue ?? await import(/* @vite-ignore */ target)
  return module[exportName] ?? module.default ?? module
}

function resolveModuleCacheKey(
  modulePath: string,
  exportName: string,
  moduleBase?: string | URL,
  moduleMap?: ModuleMap,
) {
  if (moduleMap?.[modulePath]) {
    return `${modulePath}::${exportName}`
  }
  const resolvedUrl = resolveModuleUrl(modulePath, moduleBase)
  return `${resolvedUrl}::${exportName}`
}

/**
 * Load and normalize a module-backed response rule.
 *
 * @param response - Manifest response of type "module".
 * @param moduleCache - Cache of normalized rules.
 * @param moduleBase - Base path or URL for relative modules.
 * @param moduleMap - Optional in-memory module map.
 * @returns The resolved runtime rule.
 *
 * @example
 * import { loadModuleRule } from '@mokup/runtime'
 *
 * const rule = await loadModuleRule(
 *   { type: 'module', module: './handlers/ping.mjs' },
 *   new Map(),
 * )
 */
export async function loadModuleRule(
  response: Extract<ManifestResponse, { type: 'module' }>,
  moduleCache: Map<string, RuntimeRule[]>,
  moduleBase?: string | URL,
  moduleMap?: ModuleMap,
) {
  const exportName = response.exportName ?? 'default'
  const cacheKey = resolveModuleCacheKey(
    response.module,
    exportName,
    moduleBase,
    moduleMap,
  )
  let rules = moduleCache.get(cacheKey)
  if (!rules) {
    const exported = await loadModuleExport(
      response.module,
      exportName,
      moduleBase,
      moduleMap,
    )
    rules = normalizeRules(exported)
    moduleCache.set(cacheKey, rules)
  }
  if (typeof response.ruleIndex === 'number') {
    return rules[response.ruleIndex]
  }
  return rules[0]
}

/**
 * Load and normalize middleware modules.
 *
 * @param middleware - Module reference for middleware.
 * @param middlewareCache - Cache of middleware handlers.
 * @param moduleBase - Base path or URL for relative modules.
 * @param moduleMap - Optional in-memory module map.
 * @returns The resolved middleware handlers.
 *
 * @example
 * import { loadModuleMiddleware } from '@mokup/runtime'
 *
 * const handlers = await loadModuleMiddleware(
 *   { module: './middleware/auth.mjs' },
 *   new Map(),
 * )
 */
export async function loadModuleMiddleware(
  middleware: ManifestModuleRef,
  middlewareCache: Map<string, MiddlewareHandler[]>,
  moduleBase?: string | URL,
  moduleMap?: ModuleMap,
) {
  const exportName = middleware.exportName ?? 'default'
  const cacheKey = resolveModuleCacheKey(
    middleware.module,
    exportName,
    moduleBase,
    moduleMap,
  )
  let handlers = middlewareCache.get(cacheKey)
  if (!handlers) {
    const exported = await loadModuleExport(
      middleware.module,
      exportName,
      moduleBase,
      moduleMap,
    )
    handlers = normalizeMiddleware(exported)
    middlewareCache.set(cacheKey, handlers)
  }
  if (typeof middleware.ruleIndex === 'number') {
    return handlers[middleware.ruleIndex]
  }
  return handlers[0]
}
