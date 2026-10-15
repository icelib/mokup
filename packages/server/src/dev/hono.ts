import type { Context } from '@mokup/shared/hono'

import type { ResolvedRoute, RouteTable } from './types'
import { prioritizeHeadRoutes } from '@mokup/shared/head-routes'
import { Hono, PatternRouter } from '@mokup/shared/hono'
import { registerTokenRoute } from '@mokup/shared/hono-routes'
import { applyContextResponseOverrides } from '@mokup/shared/response-overrides'
import { delay } from './utils'

function resolveResponse(value: unknown, fallback: Response) {
  if (value instanceof Response) {
    return value
  }
  if (value && typeof value === 'object' && 'res' in value) {
    const resolved = (value as { res?: unknown }).res
    if (resolved instanceof Response) {
      return resolved
    }
  }
  return fallback
}

function normalizeHandlerValue(c: Context, value: unknown): Response {
  if (value instanceof Response) {
    return value
  }
  if (typeof value === 'undefined') {
    const response = c.body(null)
    if (response.status === 200) {
      return new Response(response.body, {
        status: 204,
        headers: response.headers,
      })
    }
    return response
  }
  if (typeof value === 'string') {
    return c.text(value)
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    if (!c.res.headers.get('content-type')) {
      c.header('content-type', 'application/octet-stream')
    }
    const data = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value)
    return c.body(data)
  }
  return c.json(value)
}

function createRouteHandler(route: ResolvedRoute) {
  return async (c: Context) => {
    const value = typeof route.handler === 'function'
      ? await route.handler(c)
      : route.handler
    return normalizeHandlerValue(c, value)
  }
}

type RouteResponseHook = (route: ResolvedRoute, response: Response) => void | Promise<void>

function createFinalizeMiddleware(route: ResolvedRoute, onResponse?: RouteResponseHook) {
  return async (c: Context, next: () => Promise<Response | void>) => {
    const response = await next()
    const resolved = resolveResponse(response, c.res)
    if (route.delay && route.delay > 0) {
      await delay(route.delay)
    }
    const overridden = applyContextResponseOverrides(c, resolved, route)
    if (onResponse) {
      try {
        const result = onResponse(route, overridden)
        if (result instanceof Promise) {
          result.catch(() => undefined)
        }
      }
      catch {
        // ignore hook failures
      }
    }
    return overridden
  }
}

function wrapMiddleware(
  handler: (c: Context, next: () => Promise<void>) => Promise<Response | void>,
) {
  return async (c: Context, next: () => Promise<void>) => {
    const response = await handler(c, next)
    return resolveResponse(response, c.res)
  }
}

function splitRouteMiddlewares(route: ResolvedRoute) {
  const before: Array<ReturnType<typeof wrapMiddleware>> = []
  const normal: Array<ReturnType<typeof wrapMiddleware>> = []
  const after: Array<ReturnType<typeof wrapMiddleware>> = []
  for (const entry of route.middlewares ?? []) {
    const wrapped = wrapMiddleware(entry.handle)
    if (entry.position === 'post') {
      after.push(wrapped)
    }
    else if (entry.position === 'pre') {
      before.push(wrapped)
    }
    else {
      normal.push(wrapped)
    }
  }
  return { before, normal, after }
}

/**
 * Build a Hono app for the resolved route table.
 *
 * @param routes - Resolved route table.
 * @param options - Optional response hook.
 * @param options.onResponse - Hook for response overrides.
 * @returns Hono app instance.
 *
 * @example
 * import { createHonoApp } from '@mokup/server'
 *
 * const app = createHonoApp([])
 */
export function createHonoApp(
  routes: RouteTable,
  options: { onResponse?: RouteResponseHook } = {},
): Hono {
  const app = new Hono({ router: new PatternRouter(), strict: false })

  for (const route of prioritizeHeadRoutes(routes)) {
    const { before, normal, after } = splitRouteMiddlewares(route)
    registerTokenRoute(
      app,
      route.method,
      route.tokens ?? [],
      [createFinalizeMiddleware(route, options.onResponse), ...before, ...normal, ...after, createRouteHandler(route)],
    )
  }

  return app
}
