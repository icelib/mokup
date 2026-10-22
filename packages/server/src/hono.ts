import type { Context } from '@mokup/shared/hono'
import type { RuntimeControls, ServerOptions } from './types'
import { basePath, baseRoutePath } from '@mokup/shared/hono'
import { createFetchHandler } from './fetch'

interface HonoContextLike {
  req: {
    raw: Request
    routeIndex?: number
  }
  env?: unknown
  executionCtx?: unknown
}

type HonoNext = () => Promise<Response | void>

type HonoMiddleware = (
  context: HonoContextLike,
  next: HonoNext,
) => Promise<Response | void>

interface HonoRouteLike {
  basePath: string
  path: string
  method: string
  handler: HonoMiddleware
}

/**
 * Create a Hono middleware from server options.
 *
 * @param options - Server options.
 * @returns Hono middleware handler.
 *
 * @example
 * import { createHonoMiddleware } from '@mokup/server'
 *
 * const middleware = createHonoMiddleware({ manifest: { version: 1, routes: [] } })
 */
export function createHonoMiddleware(
  options: ServerOptions,
) {
  const handler = createFetchHandler(options)

  const middleware: HonoMiddleware = async (context, next) => {
    let executionCtx: unknown
    // Hono throws when executionCtx is accessed outside a Worker request.
    try {
      executionCtx = context.executionCtx
    }
    catch {}
    const hono = typeof context.req.routeIndex === 'number' ? context as Context : undefined
    const response = await handler(context.req.raw, {
      ...(hono ? { basePath: basePath(hono) } : {}),
      context: { env: context.env, executionCtx, ...(hono ? { hono, routeScope: baseRoutePath(hono) } : {}) },
    })
    if (!response) {
      return await next()
    }
    return response
  }

  const route: HonoRouteLike = {
    basePath: '',
    path: '*',
    method: 'ALL',
    handler: middleware,
  }

  const bridge = middleware as HonoMiddleware & {
    routes: HonoRouteLike[]
  } & RuntimeControls
  bridge.routes = [route]
  return Object.assign(bridge, handler)
}
