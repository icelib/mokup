import type { Hono, MiddlewareHandler } from 'hono'
import { registerHonoRoute } from './head-routes'
import { mapRouteParams } from './hono-route-params'

type RouteToken
  = | { type: 'static', value: string }
    | { type: 'param' | 'catchall' | 'optional-catchall', name: string }

/** Register Mokup tokens without interpreting their contents as Hono syntax. */
export function registerTokenRoute(app: Hono, method: string, tokens: readonly RouteToken[], handlers: MiddlewareHandler[]) {
  // getRandomValues also works in browser contexts without HTTPS. Distinct names
  // avoid collisions with parameters supplied by an application's mount paths.
  const namespace = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('_')
  const names = new Map<string, string | undefined>()
  const segments = tokens.map((token, index) => {
    if (token.type === 'static' && /^[\w.-]+$/.test(token.value)) {
      return token.value
    }
    const alias = `mokup_${namespace}_${index}`
    names.set(alias, token.type === 'static' ? undefined : token.name)
    if (token.type === 'static') {
      // Encode UTF-16 units so braces, pipes, colons and wildcards stay literal
      // in PatternRouter and in the routers of ordinary parent Hono apps.
      const pattern = token.value.split('').map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')
      return `:${alias}{${pattern}}`
    }
    if (token.type === 'param') {
      return `:${alias}`
    }
    return `:${alias}{.+}${token.type === 'optional-catchall' ? '?' : ''}`
  })
  registerHonoRoute(app, method, `/${segments.join('/')}`, handlers, handler => mapRouteParams(handler, names))
}
