import type { Context, Hono as HonoApp } from '@mokup/shared/hono'
import { basePath, baseRoutePath, Hono, PatternRouter } from '@mokup/shared/hono'
import { inheritHonoResponseBridge } from './hono-response'

interface HonoTransportContext {
  env?: Parameters<HonoApp['fetch']>[1]
  executionCtx?: Parameters<HonoApp['fetch']>[2]
  hono?: Context
  routeScope?: string
}

/** Capture scope before next() changes Hono's current route index. */
export function getHonoRequestContext(context: Context) {
  let executionCtx: HonoTransportContext['executionCtx']
  try {
    executionCtx = context.executionCtx
  }
  catch {}
  return {
    basePath: basePath(context),
    context: { env: context.env, executionCtx, hono: context, routeScope: baseRoutePath(context) },
  }
}

const mounts = new WeakMap<HonoApp, Map<string, HonoApp>>()
const parents = new WeakMap<Request, Context>()

/** Mount compatibility handlers using Hono's own grammar, preserving original URLs and params. */
export async function fetchHonoRouteApp(app: HonoApp, request: Request, context?: unknown): Promise<Response> {
  const transport = context as HonoTransportContext | undefined
  if (!transport?.hono) {
    return app.fetch(request, transport?.env, transport?.executionCtx)
  }
  const scope = transport.routeScope || '/'
  let registered = mounts.get(app)
  if (!registered) {
    registered = new Map()
    mounts.set(app, registered)
  }
  let mounted = registered.get(scope)
  if (!mounted) {
    mounted = new Hono({ router: new PatternRouter(), strict: false })
    mounted.use('*', async (c, next) => {
      const parent = parents.get(c.req.raw)
      if (parent) {
        const set = (c as Context).set.bind(c)
        for (const [key, value] of Object.entries(parent.var)) {
          set(key, value)
        }
        c.set = (key, value) => {
          set(key, value)
          parent.set(key, value)
        }
        const inherited = parent.req.param()
        const param = c.req.param.bind(c.req)
        c.req.param = ((key?: string) => {
          const values: Record<string, string> = { ...inherited, ...param() }
          return key ? values[key] : values
        }) as typeof c.req.param
      }
      await next()
    })
    mounted.onError((error) => {
      throw error
    })
    mounted.route(scope, app)
    inheritHonoResponseBridge(app, mounted)
    registered.set(scope, mounted)
  }
  parents.set(request, transport.hono)
  try {
    return await mounted.fetch(request, transport.env, transport.executionCtx)
  }
  finally {
    parents.delete(request)
  }
}
