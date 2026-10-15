import type { Context, Handler, MiddlewareHandler } from 'hono'
import { matchedRoutes } from 'hono/route'
import { findTargetHandler } from 'hono/utils/handler'

const routeParams = Symbol.for('mokup.routeParams')
const mappedParams = Symbol.for('mokup.mappedParams')

type ParamNames = Map<string, string | undefined>
type MappedHandler = Handler & { [routeParams]?: ParamNames }

function installParams(c: Context) {
  const req = c.req
  if (mappedParams in req.param) {
    return
  }
  const original = req.param.bind(req)
  const routes = matchedRoutes(c)
  // Hono changes routeIndex during next() and keeps it for error/response hooks.
  // Read the current handler's mapping instead of keeping a middleware-local one.
  const param = (key?: string) => {
    const handler = routes[req.routeIndex]?.handler
    const names = handler && (findTargetHandler(handler) as MappedHandler)[routeParams]
    if (!names) {
      return key ? original(key) : original()
    }
    const raw = original()
    const decoded = Object.fromEntries(Object.entries(raw).filter(([name]) => !names.has(name)))
    for (const [alias, name] of names) {
      if (typeof name === 'undefined') {
        continue
      }
      // Later duplicate names win, including an absent optional catch-all.
      delete decoded[name]
      if (Object.hasOwn(raw, alias)) {
        Object.defineProperty(decoded, name, { value: raw[alias], enumerable: true, configurable: true, writable: true })
      }
    }
    return key ? (Object.hasOwn(decoded, key) ? decoded[key] : undefined) : decoded
  }
  req.param = Object.assign(param, { [mappedParams]: true }) as typeof req.param
}

/** Carry route metadata with handlers, including when Hono copies mounted routes. */
export function mapRouteParams(handler: MiddlewareHandler, names: ParamNames): MiddlewareHandler {
  const wrapped: MiddlewareHandler = (c, next) => {
    installParams(c)
    return handler(c, next)
  }
  return Object.assign(wrapped, { [routeParams]: names })
}
