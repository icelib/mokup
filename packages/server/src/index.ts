/** Framework route adapters. */
export { createAstroEndpoint } from './astro'
export type { AstroEndpointContextLike, AstroEndpointHandler, AstroEndpointHandlers } from './astro'
/**
 * Directory config helper for dev scans.
 *
 * @example
 * import { defineConfig } from '@mokup/server'
 */
export { defineConfig, onAfterAll, onBeforeAll } from './dev/define-config'
/**
 * Dev config and middleware types.
 *
 * @example
 * import type { RouteDirectoryConfig } from '@mokup/server'
 */
export type {
  DiagnosticCategory,
  DiagnosticErrorMode,
  HookErrorPolicy,
  MiddlewareHandler,
  MiddlewarePosition,
  MiddlewareRegistry,
  ResolvedMiddleware,
  RouteDirectoryConfig,
  RouteRule,
} from './dev/types'
/**
 * Fetch handler factory.
 *
 * @example
 * import { createFetchHandler } from '@mokup/server'
 */
export { createFetchHandler } from './fetch'
export { createNextApiHandler, createNextRouteHandler } from './next'
export type { NextApiRequestLike, NextApiResponseLike, NextRouteContext, NextRouteHandler, NextRouteHandlers } from './next'
export { createNuxtHandler } from './nuxt'
export type { NuxtEventHandler, NuxtEventLike } from './nuxt'
/**
 * Core server types.
 *
 * @example
 * import type { ServerOptions } from '@mokup/server'
 */
export type {
  ControlledFetchHandler,
  FetchHandler,
  RuntimeControls,
  ServerOptions,
  WorkerBundle,
  WorkerInput,
} from './types'
/**
 * Worker helper for runtime-agnostic fetch handlers.
 *
 * @example
 * import { createMokupWorker } from '@mokup/server'
 */
export { createMokupWorker } from './worker'
/**
 * Runtime types re-exported for convenience.
 *
 * @example
 * import type { Manifest } from '@mokup/server'
 */
export type {
  Manifest,
  ManifestRoute,
  ModuleMap,
  RuntimeOptions,
} from '@mokup/runtime'
