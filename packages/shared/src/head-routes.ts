import type { Handler, Hono, MiddlewareHandler } from 'hono'
import { findTargetHandler } from 'hono/utils/handler'

const headFallbackHandler = Symbol.for('mokup.headFallbackHandler')

/** Keep explicit HEAD routes ahead of GET fallbacks without changing path priority. */
function prioritizeHeadRoutes<T extends { method: string }>(routes: readonly T[]): T[] {
  return [
    ...routes.filter(route => route.method === 'HEAD'),
    ...routes.filter(route => route.method !== 'HEAD'),
  ]
}

/** Register a complete HEAD chain for Hono's GET-based HEAD dispatch. */
function registerHonoRoute(
  app: Hono,
  method: string,
  path: string,
  handlers: MiddlewareHandler[],
  mapHandler: (handler: MiddlewareHandler) => MiddlewareHandler = handler => handler,
) {
  for (const handler of handlers) {
    app.on(method, path, mapHandler(handler))
  }
  if (method !== 'HEAD') {
    return
  }
  for (const handler of handlers) {
    const guarded: MiddlewareHandler = (c, next) => c.req.method === 'HEAD'
      ? handler(c, next)
      : next()
    app.on('GET', path, Object.assign(mapHandler(guarded), { [headFallbackHandler]: true }))
  }
}

/** Recognize guards even after Hono wraps a mounted app's custom error handler. */
function isHeadFallbackHandler(handler: Handler | MiddlewareHandler): boolean {
  return headFallbackHandler in findTargetHandler(handler)
}

export { isHeadFallbackHandler, prioritizeHeadRoutes, registerHonoRoute }
