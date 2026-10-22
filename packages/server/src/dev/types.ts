import type { RouteToken } from '@mokup/runtime'
import type { HttpRouteRule } from '@mokup/runtime/http'
import type { Context, MiddlewareHandler } from '@mokup/shared/hono'

export type { DiagnosticCategory, DiagnosticErrorMode } from '@mokup/shared'

/**
 * Supported HTTP methods for server dev routes.
 *
 * @example
 * import type { HttpMethod } from '@mokup/server'
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
 * import type { RouteStaticResponse } from '@mokup/server'
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
 * import type { RouteHandlerResult } from '@mokup/server'
 *
 * const result: RouteHandlerResult = 'ok'
 */
export type RouteHandlerResult = RouteStaticResponse | Response

/**
 * Request handler signature for server dev routes.
 *
 * @example
 * import type { RequestHandler } from '@mokup/server'
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
 * import type { RouteResponse } from '@mokup/server'
 *
 * const response: RouteResponse = { ok: true }
 */
export type RouteResponse = RouteStaticResponse | RequestHandler

/**
 * Rule metadata for a route handler.
 *
 * @example
 * import type { RouteRule } from '@mokup/server'
 *
 * const rule: RouteRule = {
 *   handler: () => ({ ok: true }),
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
 * Directory-level config for server dev scanning.
 *
 * @example
 * import type { RouteDirectoryConfig } from '@mokup/server'
 *
 * const config: RouteDirectoryConfig = { headers: { 'x-mokup': 'dir' } }
 */
export interface RouteDirectoryConfig {
  /**
   * Headers applied to routes in this directory.
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
   * Default delay in milliseconds.
   *
   * @default 0
   */
  delay?: number
  /**
   * Enable or disable this directory.
   *
   * @default true
   */
  enabled?: boolean
  /**
   * Ignore prefixes for files.
   *
   * @default ["."]
   */
  ignorePrefix?: string | string[]
  /**
   * Include filter.
   *
   * @default undefined
   */
  include?: RegExp | RegExp[]
  /**
   * Exclude filter.
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
 * import type { MiddlewarePosition } from '@mokup/server'
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
 * import type { MiddlewareRegistry } from '@mokup/server'
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
 * import type { ResolvedMiddleware } from '@mokup/server'
 *
 * const item: ResolvedMiddleware = { handle: () => {}, source: 'index.config.ts', index: 0 }
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
 * Fully resolved route metadata.
 *
 * @example
 * import type { ResolvedRoute } from '@mokup/server'
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
  status?: number
  headers?: Record<string, string>
  delay?: number
  ruleIndex?: number
}

export type RouteTable = ResolvedRoute[]

/**
 * Re-exported Hono types used by handlers.
 *
 * @example
 * import type { Context } from '@mokup/server'
 */
export type { Context, MiddlewareHandler } from '@mokup/shared/hono'
/**
 * Re-exported logger type.
 *
 * @example
 * import type { Logger } from '@mokup/server'
 */
export type { Logger } from '@mokup/shared/logger'
