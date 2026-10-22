import type { Context } from '@mokup/shared/hono'
import type { ResolvedHttpRoute } from './resolved-handlers'
import { getPath } from '@mokup/shared/hono'
import { getHonoRequestContext } from './hono-context'
import { matchRouteTokens } from './router'

/** Keep public file params available to parent response/error middleware after session dispatch. */
export function exposeFileParams(c: Context, routes: readonly ResolvedHttpRoute[]) {
  const base = getHonoRequestContext(c).basePath
  const path = getPath(c.req.raw)
  const pathname = base && base !== '/' ? path.slice(base.length) || '/' : path
  const matched = routes.map(route => ({ route, match: matchRouteTokens(route.tokens, pathname) }))
    .filter(entry => entry.match)
  const entry = matched.find(({ route }) => route.method === c.req.method)
    ?? matched.find(({ route }) => c.req.method === 'HEAD' && route.method === 'GET')
    ?? matched[0]
  if (!entry?.match) {
    return
  }
  const params = Object.fromEntries(Object.entries(entry.match.params).map(([key, value]) => [key, Array.isArray(value) ? value.join('/') : value]))
  const index = c.req.routeIndex
  const param = c.req.param.bind(c.req)
  c.req.param = ((key?: string) => {
    const values = c.req.routeIndex === index ? { ...param(), ...params } : param()
    return key ? values[key] : values
  }) as typeof c.req.param
}
