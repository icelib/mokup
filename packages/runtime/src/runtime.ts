import type { HttpHandler, HttpRequestContext, MockSession, UnhandledRequestPolicy } from './http/types'
import type { ResolvedRouteApp } from './resolved-handlers'
import type { CompiledRoute } from './runtime/routes'
import type {
  Manifest,
  ManifestRoute,
  RuntimeOptions,
  RuntimeRequest,
  RuntimeResult,
} from './types'
import { createHttpEvents } from './http/events'
import { withAbort } from './http/resources'
import { buildSession } from './http/session'
import { compileManifestHandlers } from './manifest-handlers'
import { normalizeMethod } from './normalize'
import { matchRouteTokens, normalizePathname } from './router'
import { buildApp } from './runtime/handlers'
import { snapshotManifest } from './runtime/manifest'
import { toFetchRequest } from './runtime/request'
import { toRuntimeResult } from './runtime/response'
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
export async function createRuntimeApp(options: RuntimeOptions): Promise<ResolvedRouteApp> {
  return await buildApp({
    manifest: options.manifest,
    moduleCache: new Map(),
    middlewareCache: new Map(),
    ...(options.handlers ? { handlers: options.handlers } : {}),
    ...(options.onUnhandled ? { onUnhandled: options.onUnhandled } : {}),
    ...(options.scenario ? { scenario: options.scenario } : {}),
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
  let compiledPromise: Promise<CompiledRoute[]> | null = null
  const emitter = createHttpEvents()
  const lifetime = new AbortController()
  let session: MockSession | undefined
  let sessionPromise: Promise<MockSession> | undefined
  let closed = false
  const pendingControls: Array<(session: MockSession) => void> = []

  const getManifest = () => {
    if (!manifestPromise) {
      manifestPromise = Promise.resolve()
        .then(() => typeof options.manifest === 'function' ? options.manifest() : options.manifest)
        .then(snapshotManifest)
        .catch((error: unknown) => {
          manifestPromise = null
          throw error
        })
    }
    return manifestPromise
  }

  const ready = (): Promise<MockSession> => {
    if (closed) {
      return Promise.reject(new Error('Cannot use a closed mock runtime.'))
    }
    sessionPromise ??= withAbort(getManifest().then(async (manifest) => {
      const handlers = await compileManifestHandlers({ ...options, manifest })
      if (closed) {
        throw new Error('Cannot use a closed mock runtime.')
      }
      session = buildSession({
        handlers: [...options.handlers ?? [], ...handlers],
        ...(options.onUnhandled ? { onUnhandled: options.onUnhandled } : {}),
        ...(options.scenario ? { scenario: options.scenario } : {}),
      }, emitter)
      for (const apply of pendingControls.splice(0)) {
        apply(session)
      }
      return session
    }), lifetime.signal).catch((error: unknown) => {
      sessionPromise = undefined
      throw error
    })
    return sessionPromise
  }

  const control = (apply: (session: MockSession) => void) => {
    if (closed) {
      throw new Error('Cannot use a closed mock runtime.')
    }
    if (session) {
      apply(session)
    }
    else {
      pendingControls.push(apply)
    }
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

  const fetch = async (request: Request, context?: HttpRequestContext): Promise<Response | null> => {
    return await (await withAbort(ready(), request.signal)).handle(request, context) ?? null
  }

  const handle = async (req: RuntimeRequest, context?: HttpRequestContext): Promise<RuntimeResult | null> => {
    const response = await fetch(toFetchRequest(req), context)
    return response ? await toRuntimeResult(response) : null
  }

  return {
    signal: lifetime.signal,
    hasRoute,
    handle,
    fetch,
    ready,
    use: (...handlers: HttpHandler[]) => control(session => session.use(...handlers)),
    resetHandlers: (...handlers: HttpHandler[]) => control(session => session.resetHandlers(...handlers)),
    restoreHandlers: () => control(session => session.restoreHandlers()),
    setOnUnhandled: (policy: UnhandledRequestPolicy) => control(session => session.setOnUnhandled(policy)),
    get scenario() { return session?.scenario },
    selectScenario: (name: string) => control(session => session.selectScenario(name)),
    resetScenario: () => control(session => session.resetScenario()),
    listHandlers: async () => (await ready()).listHandlers(),
    events: emitter.events,
    async close() {
      closed = true
      lifetime.abort(new DOMException('Mock runtime closed.', 'AbortError'))
      pendingControls.length = 0
      await session?.dispose()
    },
  }
}
