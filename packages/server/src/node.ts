/** Astro endpoint adapter. */
export { createAstroEndpoint } from './astro'
export type { AstroEndpointContextLike, AstroEndpointHandler, AstroEndpointHandlers } from './astro'
/**
 * Connect middleware factory.
 *
 * @example
 * import { createConnectMiddleware } from '@mokup/server/node'
 */
export { createConnectMiddleware } from './connect'
/**
 * Re-export diagnostics control types.
 *
 * @example
 * import type { DiagnosticErrorMode } from '@mokup/server/node'
 */
export type { DiagnosticCategory, DiagnosticErrorMode } from './dev/types'
/**
 * Express middleware factory.
 *
 * @example
 * import { createExpressMiddleware } from '@mokup/server/node'
 */
export { createExpressMiddleware } from './express'
/**
 * Fastify plugin factory.
 *
 * @example
 * import { createFastifyPlugin } from '@mokup/server/node'
 */
export { createFastifyPlugin } from './fastify'
/**
 * Fetch server option types.
 *
 * @example
 * import type { FetchServerOptions } from '@mokup/server/node'
 */
export type {
  FetchServerOptions,
  FetchServerOptionsConfig,
  FetchServerOptionsInput,
} from './fetch-options'
/**
 * Fetch server factory.
 *
 * @example
 * import { createFetchServer } from '@mokup/server/node'
 */
export { createFetchServer } from './fetch-server'
/**
 * Fetch server interface.
 *
 * @example
 * import type { FetchServer } from '@mokup/server/node'
 */
export type { FetchServer } from './fetch-server'
/**
 * Hono middleware factory.
 *
 * @example
 * import { createHonoMiddleware } from '@mokup/server/node'
 */
export { createHonoMiddleware } from './hono'
/**
 * Koa middleware factory.
 *
 * @example
 * import { createKoaMiddleware } from '@mokup/server/node'
 */
export { createKoaMiddleware } from './koa'
/** Next.js App Router and Pages Router adapters. */
export { createNextApiHandler, createNextRouteHandler } from './next'
export type { NextApiRequestLike, NextApiResponseLike, NextRouteContext, NextRouteHandler, NextRouteHandlers } from './next'
/** Nuxt/Nitro event adapter. */
export { createNuxtHandler } from './nuxt'
export type { NuxtEventHandler, NuxtEventLike } from './nuxt'
/**
 * Node worker helper.
 *
 * @example
 * import { createMokupWorker } from '@mokup/server/node'
 */
export { createMokupWorker } from './worker-node'
/**
 * Node worker input type.
 *
 * @example
 * import type { NodeWorkerInput } from '@mokup/server/node'
 */
export type { NodeWorkerInput } from './worker-node'
/**
 * Re-export Hono Node server helper.
 *
 * @example
 * import { serve } from '@mokup/server/node'
 */
export { serve, upgradeWebSocket } from '@hono/node-server'
