import type { Hono } from '@mokup/shared/hono'
import type { RuntimeRule } from './module'
import type { CompiledRoute } from './runtime/routes'
import type {
  Manifest,
  ManifestRoute,
  MiddlewareHandler,
  RuntimeOptions,
  RuntimeRequest,
  RuntimeResult,
} from './types'
import { normalizeMethod } from './normalize'
import { matchRouteTokens, normalizePathname } from './router'
import { buildApp } from './runtime/handlers'
import { routeNeedsModuleBase, toFetchRequest } from './runtime/request'
import { applyRouteOverrides, toRuntimeResult } from './runtime/response'
import { compileRoutes } from './runtime/routes'

/**
 * Build a Hono app from a manifest, loading module handlers as needed.
 *
 * @param options - Runtime options including the manifest.
 * @returns A Hono app with routes registered.
 *
 * @example
 * import { createRuntimeApp } from '@mokup/runtime'
 *
 * const app = await createRuntimeApp({
 *   manifest: { version: 1, routes: [] },
 * })
 */
export async function createRuntimeApp(options: RuntimeOptions): Promise<Hono> {
  const moduleCache = new Map<string, RuntimeRule[]>()
  const middlewareCache = new Map<string, MiddlewareHandler[]>()
  return await buildApp({
    manifest: options.manifest,
    moduleCache,
    middlewareCache,
    ...(typeof options.moduleBase !== 'undefined'
      ? { moduleBase: options.moduleBase }
      : {}),
    ...(typeof options.moduleMap !== 'undefined'
      ? { moduleMap: options.moduleMap }
      : {}),
  })
}

/**
 * Create a cached runtime handler for fetching and request simulation.
 *
 * @param options - Runtime options including the manifest.
 * @returns Runtime helper with fetch and match helpers.
 *
 * @example
 * import { createRuntime } from '@mokup/runtime'
 *
 * const runtime = createRuntime({
 *   manifest: { version: 1, routes: [] },
 * })
 */
export function createRuntime(options: RuntimeOptions) {
  let manifestPromise: Promise<Manifest> | null = null
  let appPromise: Promise<Hono> | null = null
  let compiledPromise: Promise<CompiledRoute[]> | null = null
  const moduleCache = new Map<string, RuntimeRule[]>()
  const middlewareCache = new Map<string, MiddlewareHandler[]>()

  const getManifest = () => {
    if (!manifestPromise) {
      manifestPromise = Promise.resolve()
        .then(() => typeof options.manifest === 'function' ? options.manifest() : options.manifest)
        .catch((error: unknown) => {
          manifestPromise = null
          throw error
        })
    }
    return manifestPromise
  }

  const getApp = async () => {
    if (!appPromise) {
      appPromise = (async () => {
        const manifest = await getManifest()
        return buildApp({
          manifest,
          moduleCache,
          middlewareCache,
          ...(typeof options.moduleBase !== 'undefined'
            ? { moduleBase: options.moduleBase }
            : {}),
          ...(typeof options.moduleMap !== 'undefined'
            ? { moduleMap: options.moduleMap }
            : {}),
        })
      })()
    }
    return appPromise
  }

  const getCompiled = () => {
    if (!compiledPromise) {
      compiledPromise = getManifest()
        .then(compileRoutes)
        .catch((error: unknown) => {
          compiledPromise = null
          throw error
        })
    }
    return compiledPromise
  }

  const findMatchedRoute = async (req: Pick<RuntimeRequest, 'method' | 'path'>): Promise<ManifestRoute | null> => {
    const method = normalizeMethod(req.method) ?? 'GET'
    const matchMethods = method === 'HEAD' ? ['HEAD', 'GET'] : [method]
    const pathname = normalizePathname(req.path)
    const compiled = await getCompiled()
    for (const matchMethod of matchMethods) {
      const entry = compiled.find(entry => entry.method === matchMethod && matchRouteTokens(entry.tokens, pathname))
      if (entry) {
        return entry.route
      }
    }
    return null
  }

  const hasRoute = async (req: Pick<RuntimeRequest, 'method' | 'path'>): Promise<boolean> => {
    return await findMatchedRoute(req) !== null
  }

  const handle = async (req: RuntimeRequest): Promise<RuntimeResult | null> => {
    const matchedRoute = await findMatchedRoute(req)
    if (!matchedRoute) {
      return null
    }
    if (
      typeof options.moduleBase === 'undefined'
      && routeNeedsModuleBase(matchedRoute, options.moduleMap)
    ) {
      throw new Error('moduleBase is required for relative module paths.')
    }
    const app = await getApp()
    const response = await app.fetch(toFetchRequest(req))
    const method = normalizeMethod(req.method) ?? 'GET'
    const resolvedResponse = applyRouteOverrides(response, matchedRoute, method)
    return await toRuntimeResult(resolvedResponse)
  }

  return {
    hasRoute,
    handle,
  }
}
