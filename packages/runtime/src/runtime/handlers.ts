import type { Context } from '@mokup/shared/hono'
import type { RuntimeRule } from '../module'
import type { ManifestRoute, MiddlewareHandler, ModuleMap, RuntimeOptions } from '../types'
import { prioritizeHeadRoutes } from '@mokup/shared/head-routes'
import { Hono, PatternRouter } from '@mokup/shared/hono'
import { registerTokenRoute } from '@mokup/shared/hono-routes'
import { applyContextResponseOverrides } from '@mokup/shared/response-overrides'
import { executeRule, loadModuleMiddleware, loadModuleRule } from '../module'
import { delay } from '../normalize'
import { decodeBase64 } from '../response'
import { resolveResponse } from './response'
import { compileRoutes } from './routes'

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
    const data = value instanceof ArrayBuffer ? value : new Uint8Array(value)
    return c.body(data)
  }
  return c.json(value)
}

function createRouteHandler(params: {
  route: ManifestRoute
  moduleCache: Map<string, RuntimeRule[]>
  moduleBase?: string | URL
  moduleMap?: ModuleMap
}) {
  const { route, moduleCache, moduleBase, moduleMap } = params

  return async (c: Context) => {
    if (route.response.type === 'json') {
      if (typeof route.response.body === 'undefined') {
        return normalizeHandlerValue(c, undefined)
      }
      return c.json(route.response.body)
    }
    if (route.response.type === 'text') {
      return c.text(route.response.body)
    }
    if (route.response.type === 'binary') {
      const data = new Uint8Array(decodeBase64(route.response.body))
      c.header('content-type', 'application/octet-stream')
      return c.body(data)
    }

    const rule = await loadModuleRule(
      route.response,
      moduleCache,
      moduleBase,
      moduleMap,
    )
    const value = await executeRule(rule, c)
    return normalizeHandlerValue(c, value)
  }
}

function createFinalizeMiddleware(route: ManifestRoute): MiddlewareHandler {
  return async (c, next) => {
    const response = await next()
    const resolved = resolveResponse(response, c.res)
    if (route.delay && route.delay > 0) {
      await delay(route.delay)
    }
    return applyContextResponseOverrides(c, resolved, route)
  }
}

async function buildApp(params: {
  manifest: RuntimeOptions['manifest']
  moduleCache: Map<string, RuntimeRule[]>
  middlewareCache: Map<string, MiddlewareHandler[]>
  moduleBase?: string | URL
  moduleMap?: ModuleMap
}) {
  const manifest = typeof params.manifest === 'function'
    ? await params.manifest()
    : params.manifest
  const app = new Hono({ router: new PatternRouter(), strict: false })
  const compiled = compileRoutes(manifest)

  for (const entry of prioritizeHeadRoutes(compiled)) {
    const middlewares: MiddlewareHandler[] = []
    for (const middleware of entry.route.middleware ?? []) {
      const handler = await loadModuleMiddleware(
        middleware,
        params.middlewareCache,
        params.moduleBase,
        params.moduleMap,
      )
      if (handler) {
        middlewares.push(handler)
      }
    }

    const handler = createRouteHandler({
      route: entry.route,
      moduleCache: params.moduleCache,
      ...(typeof params.moduleBase !== 'undefined' ? { moduleBase: params.moduleBase } : {}),
      ...(typeof params.moduleMap !== 'undefined' ? { moduleMap: params.moduleMap } : {}),
    })

    registerTokenRoute(
      app,
      entry.method,
      entry.tokens,
      [createFinalizeMiddleware(entry.route), ...middlewares, handler],
    )
  }

  return app
}

export { buildApp }
