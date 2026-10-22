import type { Context } from '@mokup/shared/hono'
import type { HttpResolver, HttpResolverContext } from '../http/types'
import type { RuntimeRule } from '../module'
import type { ResolvedHttpRoute } from '../resolved-handlers'
import type { ManifestRoute, MiddlewareHandler, ModuleMap, RuntimeOptions } from '../types'
import { executeRule, loadModuleMiddleware, loadModuleRule } from '../module'
import { createResolvedRouteApp } from '../resolved-handlers'
import { decodeBase64 } from '../response'
import { snapshotManifest } from './manifest'
import { compileRoutes } from './routes'

interface ManifestRouteInputs {
  manifest: RuntimeOptions['manifest']
  moduleCache: Map<string, RuntimeRule[]>
  middlewareCache: Map<string, MiddlewareHandler[]>
  moduleBase?: string | URL
  moduleMap?: ModuleMap
}

function createRouteHandler(route: ManifestRoute, params: ManifestRouteInputs) {
  if (route.handlerType === 'http') {
    return async (context: HttpResolverContext) => {
      if (route.response.type !== 'module') {
        throw new TypeError('Native file handlers require a module response.')
      }
      const rule = await loadModuleRule(route.response, params.moduleCache, params.moduleBase, params.moduleMap)
      if (rule?.handlerType !== 'http' || typeof rule.handler !== 'function') {
        throw new TypeError('Native file modules must export defineHttpHandler() rules.')
      }
      return (rule.handler as HttpResolver)(context)
    }
  }
  return async (c: Context) => {
    if (route.response.type === 'json') {
      return route.response.body === undefined ? undefined : c.json(route.response.body)
    }
    if (route.response.type === 'text') {
      return c.text(route.response.body)
    }
    if (route.response.type === 'binary') {
      c.header('content-type', 'application/octet-stream')
      return c.body(new Uint8Array(decodeBase64(route.response.body)))
    }
    const rule = await loadModuleRule(route.response, params.moduleCache, params.moduleBase, params.moduleMap)
    return executeRule(rule, c)
  }
}

/** Manifest metadata is authoritative; modules load only when the selected rule executes. */
export async function createManifestRoutes(params: ManifestRouteInputs): Promise<ResolvedHttpRoute[]> {
  const manifest = snapshotManifest(typeof params.manifest === 'function' ? await params.manifest() : params.manifest)
  return compileRoutes(manifest).map((entry) => {
    let middlewarePromise: Promise<NonNullable<ResolvedHttpRoute['middlewares']>> | undefined
    const loadMiddlewares = () => {
      middlewarePromise ??= Promise.all((entry.route.middleware ?? []).map(async (middleware) => {
        const handle = await loadModuleMiddleware(middleware, params.middlewareCache, params.moduleBase, params.moduleMap)
        return handle ? { handle, position: 'normal' as const } : undefined
      })).then(entries => entries.filter(entry => entry !== undefined)).catch((error: unknown) => {
        middlewarePromise = undefined
        throw error
      })
      return middlewarePromise
    }
    return {
      method: entry.method,
      tokens: entry.tokens,
      handler: createRouteHandler(entry.route, params),
      loadMiddlewares,
      ...(entry.route.handlerType !== undefined ? { handlerType: entry.route.handlerType } : {}),
      ...(entry.route.once !== undefined ? { once: entry.route.once } : {}),
      ...(entry.route.status !== undefined ? { status: entry.route.status } : {}),
      ...(entry.route.headers !== undefined ? { headers: entry.route.headers } : {}),
      ...(entry.route.delay !== undefined ? { delay: entry.route.delay } : {}),
    }
  })
}

export async function buildApp(params: ManifestRouteInputs & Pick<RuntimeOptions, 'handlers' | 'onUnhandled' | 'scenario'>) {
  return createResolvedRouteApp(await createManifestRoutes(params), {
    ...(params.handlers ? { handlers: params.handlers } : {}),
    ...(params.onUnhandled ? { onUnhandled: params.onUnhandled } : {}),
    ...(params.scenario ? { scenario: params.scenario } : {}),
  })
}
