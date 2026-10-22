import type { RouteToken } from '@mokup/runtime'
import type { HttpHandler, HttpRouteRule, UnhandledRequestPolicy } from '@mokup/runtime/http'
import type { DiagnosticErrorMode, MockEntryOptions, PlaygroundOptionsInput } from '@mokup/shared'
import type { Context, MiddlewareHandler } from '@mokup/shared/hono'

export type { DiagnosticCategory, DiagnosticErrorMode } from '@mokup/shared'

/**
 * Supported HTTP methods for mokup routes.
 *
 * @example
 * import type { HttpMethod } from 'mokup/vite'
 *
 * const method: HttpMethod = 'GET'
 */
export type HttpMethod
  = | 'GET'
    | 'POST'
    | 'PUT'
    | 'PATCH'
    | 'DELETE'
    | 'OPTIONS'
    | 'HEAD'

/**
 * Static response payloads supported by route rules.
 *
 * @example
 * import type { RouteStaticResponse } from 'mokup/vite'
 *
 * const value: RouteStaticResponse = { ok: true }
 */
export type RouteStaticResponse
  = | string
    | number
    | boolean
    | bigint
    | symbol
    | null
    | undefined
    | object

/**
 * Allowed return value from a route handler.
 *
 * @example
 * import type { RouteHandlerResult } from 'mokup/vite'
 *
 * const result: RouteHandlerResult = 'ok'
 */
export type RouteHandlerResult = RouteStaticResponse | Response

/**
 * Request handler signature for mokup routes.
 *
 * @example
 * import type { RequestHandler } from 'mokup/vite'
 *
 * const handler: RequestHandler = (c) => c.json({ ok: true })
 */
export type RequestHandler = (
  context: Context,
) => RouteHandlerResult | Promise<RouteHandlerResult>

/**
 * Route response as a static value or handler.
 *
 * @example
 * import type { RouteResponse } from 'mokup/vite'
 *
 * const response: RouteResponse = { ok: true }
 */
export type RouteResponse = RouteStaticResponse | RequestHandler

/**
 * Rule metadata for a route handler.
 *
 * @example
 * import type { RouteRule } from 'mokup/vite'
 *
 * const rule: RouteRule = {
 *   handler: () => ({ ok: true }),
 *   status: 200,
 * }
 */
export interface RouteRule {
  handlerType?: 'hono'
  once?: boolean
  /** Handler for the route. */
  handler: RouteResponse
  /**
   * Enable or disable this rule.
   *
   * @default true
   */
  enabled?: boolean
  /**
   * Override response status code.
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

export type FileRouteRule = RouteRule | HttpRouteRule

/**
 * Runtime mode for Vite integration.
 *
 * @example
 * import type { RuntimeMode } from 'mokup/vite'
 *
 * const mode: RuntimeMode = 'sw'
 */
export type RuntimeMode = 'server' | 'sw'
/**
 * Execution runtime target for mokup plugins.
 *
 * @example
 * import type { RuntimeTarget } from 'mokup/vite'
 *
 * const runtime: RuntimeTarget = 'node'
 */
export type RuntimeTarget = 'node' | 'worker'

/**
 * Service worker behavior options for mokup.
 *
 * @example
 * import type { ServiceWorkerOptions } from 'mokup/vite'
 *
 * const sw: ServiceWorkerOptions = {
 *   path: '/mokup-sw.js',
 *   scope: '/',
 * }
 */
export interface ServiceWorkerOptions {
  /**
   * Service worker script path.
   *
   * @default "/mokup-sw.js"
   */
  path?: string
  /**
   * Service worker scope.
   *
   * @default "/"
   */
  scope?: string
  /**
   * Auto-register the service worker.
   *
   * @default true
   */
  register?: boolean
  /**
   * Inject an unregister script instead of registering a service worker.
   *
   * @default false
   */
  unregister?: boolean
  /**
   * Allow SW fallback to direct network when not matched.
   *
   * @default true
   */
  fallback?: boolean
  /**
   * Base paths the service worker should handle.
   *
   * @default []
   */
  basePath?: string | string[]
}

export type { DirInput, MockEntryOptions, PlaygroundOptionsInput } from '@mokup/shared'

/**
 * Directory-level route configuration loaded from index.config.* files.
 *
 * @example
 * import type { RouteDirectoryConfig } from 'mokup/vite'
 *
 * const config: RouteDirectoryConfig = {
 *   headers: { 'x-mokup': 'dir' },
 * }
 */
export interface RouteDirectoryConfig {
  /**
   * Headers applied to routes under this directory.
   *
   * @default {}
   */
  headers?: Record<string, string>
  /**
   * Default status code override.
   *
   * @default 200
   */
  status?: number
  /**
   * Delay in milliseconds.
   *
   * @default 0
   */
  delay?: number
  /**
   * Enable or disable routes under this directory.
   *
   * @default true
   */
  enabled?: boolean
  /**
   * Ignore prefixes within the directory.
   *
   * @default ["."]
   */
  ignorePrefix?: string | string[]
  /**
   * Include filter for route files.
   *
   * @default undefined
   */
  include?: RegExp | RegExp[]
  /**
   * Exclude filter for route files.
   *
   * @default undefined
   */
  exclude?: RegExp | RegExp[]
  /**
   * Middleware for this directory.
   *
   * @default undefined
   */
  middleware?: MiddlewareHandler | MiddlewareHandler[]
  /**
   * Error handling policy for defineConfig hooks.
   *
   * @default "warn"
   */
  hookError?: HookErrorPolicy
}

/**
 * Middleware execution position.
 *
 * @example
 * import type { MiddlewarePosition } from 'mokup/vite'
 *
 * const position: MiddlewarePosition = 'pre'
 */
export type MiddlewarePosition = 'pre' | 'normal' | 'post'

/**
 * Error handling policy for config hooks.
 */
export type HookErrorPolicy = 'throw' | 'warn' | 'silent'

/**
 * Middleware registry used by defineConfig.
 *
 * @example
 * import type { MiddlewareRegistry } from 'mokup/vite'
 *
 * const registry: MiddlewareRegistry = { use: () => {} }
 */
export interface MiddlewareRegistry {
  use: (...handlers: MiddlewareHandler[]) => void
}

/**
 * Normalized middleware metadata.
 *
 * @example
 * import type { ResolvedMiddleware } from 'mokup/vite'
 *
 * const item: ResolvedMiddleware = {
 *   handle: () => {},
 *   source: 'index.config.ts',
 *   index: 0,
 * }
 */
export interface ResolvedMiddleware {
  handle: MiddlewareHandler
  source: string
  index: number
  /**
   * Position in the middleware chain.
   *
   * @default "normal"
   */
  position: MiddlewarePosition
}

/**
 * Options for a single Vite entry.
 *
 * @example
 * import type { VitePluginOptions } from 'mokup/vite'
 *
 * const options: VitePluginOptions = {
 *   dir: 'mock',
 *   prefix: '/api',
 * }
 */
export interface VitePluginOptions extends MockEntryOptions {
  /**
   * Runtime mode per entry.
   *
   * @default "server"
   */
  mode?: RuntimeMode
  /**
   * Service worker options for this entry.
   *
   * @default undefined
   */
  sw?: ServiceWorkerOptions
}

/**
 * Top-level plugin options for mokup/vite.
 *
 * @example
 * import type { MokupPluginOptions } from 'mokup/vite'
 *
 * const options: MokupPluginOptions = {
 *   entries: { dir: 'mock' },
 *   playground: true,
 * }
 */
export interface MokupPluginOptions {
  /** Native HTTP definitions included in the server session's initial handlers. */
  handlers?: readonly HttpHandler[]
  /** Policy for requests that reach the mock middleware without a response. */
  onUnhandled?: UnhandledRequestPolicy
  /**
   * One or more entries to scan for mocks.
   *
   * @default [{ }]
   */
  entries?: VitePluginOptions | VitePluginOptions[]
  /**
   * Playground configuration.
   *
   * @default { enabled: true, path: "/__mokup" }
   */
  playground?: PlaygroundOptionsInput
  /**
   * Runtime target for the Vite plugin.
   *
   * @default "node"
   */
  runtime?: RuntimeTarget
  /**
   * Promote selected diagnostics from warnings to errors.
   *
   * @default undefined
   */
  errorOn?: DiagnosticErrorMode
}

/**
 * Alias for Vite plugin options.
 *
 * @example
 * import type { VitePluginOptionsInput } from 'mokup/vite'
 *
 * const options: VitePluginOptionsInput = { entries: { dir: 'mock' } }
 */
export type VitePluginOptionsInput = MokupPluginOptions

/**
 * Fully resolved route metadata.
 *
 * @example
 * import type { ResolvedRoute } from 'mokup/vite'
 *
 * const route: ResolvedRoute = {
 *   file: '/mock/ping.get.ts',
 *   template: '/ping',
 *   method: 'GET',
 *   tokens: [{ type: 'static', value: 'ping' }],
 *   score: [4],
 *   handler: () => ({ ok: true }),
 * }
 */
export interface ResolvedRoute {
  handlerType?: 'hono' | 'http'
  once?: boolean
  file: string
  template: string
  method: HttpMethod
  tokens: RouteToken[]
  score: number[]
  handler: RouteResponse
  middlewares?: ResolvedMiddleware[]
  /**
   * Ordered config file chain applied to this route (root to leaf).
   *
   * @default []
   */
  configChain?: string[]
  status?: number
  headers?: Record<string, string>
  delay?: number
  ruleIndex?: number
}

/**
 * List of resolved routes.
 *
 * @example
 * import type { RouteTable } from 'mokup/vite'
 *
 * const table: RouteTable = []
 */
export type RouteTable = ResolvedRoute[]

/**
 * Re-exported Hono types used by handlers.
 *
 * @example
 * import type { Context } from 'mokup/vite'
 */
export type { Context, MiddlewareHandler } from '@mokup/shared/hono'
/**
 * Re-exported logger type.
 *
 * @example
 * import type { Logger } from 'mokup/vite'
 */
export type { Logger } from '@mokup/shared/logger'
