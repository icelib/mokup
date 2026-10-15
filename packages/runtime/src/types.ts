import type { Context } from '@mokup/shared/hono'
import type { RouteToken } from './router'

/**
 * Supported HTTP methods for mock routes.
 *
 * @example
 * import type { HttpMethod } from '@mokup/runtime'
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
 * Serialized manifest describing all mock routes.
 *
 * @example
 * import type { Manifest } from '@mokup/runtime'
 *
 * const manifest: Manifest = {
 *   version: 1,
 *   routes: [],
 * }
 */
export interface Manifest {
  /**
   * Manifest schema version.
   *
   * @default 1
   */
  version: 1
  /**
   * Route entries in this manifest.
   *
   * @default []
   */
  routes: ManifestRoute[]
}

/**
 * One route entry inside the manifest.
 *
 * @example
 * import type { ManifestRoute } from '@mokup/runtime'
 *
 * const route: ManifestRoute = {
 *   method: 'GET',
 *   url: '/api/ping',
 *   response: { type: 'json', body: { ok: true } },
 * }
 */
export interface ManifestRoute {
  /** HTTP method of the route. */
  method: HttpMethod
  /** URL template for the route. */
  url: string
  /** Pre-parsed route tokens (optional optimization). */
  tokens?: RouteToken[]
  /** Route score used for sorting and matching. */
  score?: number[]
  /** Source file path for the route handler. */
  source?: string
  /**
   * Override response status code.
   *
   * @default 200
   */
  status?: number
  /**
   * Additional headers to apply to the response.
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
  /**
   * Middleware module references to apply before the handler.
   *
   * @default []
   */
  middleware?: ManifestModuleRef[]
  /** Response definition for this route. */
  response: ManifestResponse
}

/**
 * Reference to a module export produced by mokup build.
 *
 * @example
 * import type { ManifestModuleRef } from '@mokup/runtime'
 *
 * const ref: ManifestModuleRef = {
 *   module: './mokup-handlers/mock/ping.get.mjs',
 *   exportName: 'default',
 * }
 */
export interface ManifestModuleRef {
  /** Module path (absolute or relative to moduleBase). */
  module: string
  /**
   * Named export to load from the module.
   *
   * @default "default"
   */
  exportName?: string
  /**
   * Optional rule index when multiple rules exist in one module.
   *
   * @default 0
   */
  ruleIndex?: number
}

/**
 * Response descriptor stored in the manifest.
 *
 * @example
 * import type { ManifestResponse } from '@mokup/runtime'
 *
 * const response: ManifestResponse = {
 *   type: 'text',
 *   body: 'ok',
 * }
 */
export type ManifestResponse
  = | {
    type: 'json'
    body: unknown
  }
  | {
    type: 'text'
    body: string
  }
  | {
    type: 'binary'
    body: string
    encoding: 'base64'
  }
  | ({ type: 'module' } & ManifestModuleRef)

/**
 * Normalized request input for runtime execution.
 *
 * @example
 * import type { RuntimeRequest } from '@mokup/runtime'
 *
 * const request: RuntimeRequest = {
 *   method: 'GET',
 *   path: '/api/ping',
 *   query: {},
 *   headers: {},
 *   body: null,
 * }
 */
export interface RuntimeRequest {
  /** HTTP method. */
  method: string
  /** Request path (no origin). */
  path: string
  /** Parsed query parameters. */
  query: Record<string, string | string[]>
  /** Normalized request headers. */
  headers: Record<string, string>
  /** Parsed request body. */
  body: unknown
  /** Raw body text (if available). */
  rawBody?: string
  /** Original body bytes, preferred over rawBody and body when available. */
  rawBodyBytes?: Uint8Array
  /** Path params captured during matching. */
  params?: Record<string, string | string[]>
}

/**
 * Normalized runtime response output.
 *
 * @example
 * import type { RuntimeResult } from '@mokup/runtime'
 *
 * const result: RuntimeResult = {
 *   status: 200,
 *   headers: { 'content-type': 'application/json' },
 *   body: '{"ok":true}',
 * }
 */
export interface RuntimeResult {
  /**
   * HTTP status code.
   *
   * @default 200
   */
  status: number
  /**
   * Response headers. Set-Cookie retains its last scalar value; use setCookies
   * when present to emit all cookie fields.
   *
   * @default {}
   */
  headers: Record<string, string>
  /** All Set-Cookie field values when the response contains multiple cookies. */
  setCookies?: string[]
  /** Response body as text or binary. */
  body: string | Uint8Array | null
}

/**
 * Static response values supported by route handlers.
 *
 * @example
 * import type { RouteStaticResponse } from '@mokup/runtime'
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
 * Allowed return values from a route handler.
 *
 * @example
 * import type { RouteHandlerResult } from '@mokup/runtime'
 *
 * const result: RouteHandlerResult = 'ok'
 */
export type RouteHandlerResult = RouteStaticResponse | Response

/**
 * Function signature for request handlers.
 *
 * @example
 * import type { RequestHandler } from '@mokup/runtime'
 *
 * const handler: RequestHandler = (c) => {
 *   return { ok: true }
 * }
 */
export type RequestHandler = (
  context: Context,
) => RouteHandlerResult | Promise<RouteHandlerResult>

/**
 * Route response as a static value or handler function.
 *
 * @example
 * import type { RouteResponse } from '@mokup/runtime'
 *
 * const response: RouteResponse = (c) => c.text('ok')
 */
export type RouteResponse = RouteStaticResponse | RequestHandler

/**
 * Re-export Hono context and middleware types for handler signatures.
 *
 * @example
 * import type { Context } from '@mokup/runtime'
 */
export type { Context, MiddlewareHandler } from '@mokup/shared/hono'

/**
 * Runtime configuration options.
 *
 * @example
 * import type { RuntimeOptions } from '@mokup/runtime'
 *
 * const options: RuntimeOptions = {
 *   manifest: { version: 1, routes: [] },
 * }
 */
export interface RuntimeOptions {
  /**
   * Manifest object or async loader.
   */
  manifest: Manifest | (() => Promise<Manifest>)
  /**
   * Base directory for resolving module paths.
   *
   * @default undefined
   */
  moduleBase?: string | URL | undefined
  /**
   * Map of module exports for in-memory execution.
   *
   * @default undefined
   */
  moduleMap?: ModuleMap | undefined
}

/**
 * Map of module path to exported members.
 *
 * @example
 * import type { ModuleMap } from '@mokup/runtime'
 *
 * const moduleMap: ModuleMap = {
 *   './handlers/ping.mjs': { default: () => ({ ok: true }) },
 * }
 */
export type ModuleMap = Record<string, Record<string, unknown>>
