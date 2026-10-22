import type { Context, Hono as HonoApp, MiddlewareHandler } from '@mokup/shared/hono'
import type { HttpResolver, HttpResolverContext, HttpResolverResult, HttpResolverReturn } from './http/types'
import type { ResolvedHttpRoute, ResolvedRouteAppOptions } from './resolved-handlers'
import { Hono, PatternRouter } from '@mokup/shared/hono'
import { registerTokenRoute } from '@mokup/shared/hono-routes'
import { applyContextResponseOverrides } from '@mokup/shared/response-overrides'
import { fetchHonoRouteApp, getHonoRequestContext } from './hono-context'
import { createHonoResponseBridge, preserveHonoResponse } from './hono-response'
import { isResponse } from './http/is-response'
import { delay } from './http/response'
import { copyResponseCookies } from './http/response-cookies'

interface Execution<Route> {
  route: Route
  context: HttpResolverContext
  resolve: (context?: HttpResolverContext) => Promise<HttpResolverResult>
  result?: HttpResolverResult
  overridden: boolean
  userActive: boolean
  errorResponse?: Response | undefined
  response?: Response | undefined
}

function resolveResponse(value: unknown, fallback: Response): Response {
  if (isResponse(value)) {
    return value
  }
  if (value && typeof value === 'object' && 'res' in value && isResponse(value.res)) {
    return value.res
  }
  return fallback
}

function normalizeValue(c: Context, value: unknown): Response {
  if (isResponse(value)) {
    return preserveHonoResponse(c, value)
  }
  if (value === undefined) {
    const response = c.body(null)
    return response.status === 200 ? new Response(null, { status: 204, headers: response.headers }) : response
  }
  if (typeof value === 'string') {
    return c.text(value)
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    if (!c.res.headers.get('content-type')) {
      c.header('content-type', 'application/octet-stream')
    }
    return c.body(new Uint8Array(value))
  }
  return c.json(value)
}

/** Hono needs a valid status while middleware runs; network errors keep their native result. */
function middlewareResponse<Route>(state: Execution<Route>, response: Response): Response {
  state.errorResponse = response.type === 'error' ? response : undefined
  return state.errorResponse ? new Response(null, { status: 204 }) : response
}

function discardBody(context: HttpResolverContext, response: Response) {
  if (response.body && !response.body.locked) {
    const cancellation = response.body.cancel(context.request.signal.reason)
    void cancellation.catch(() => undefined)
    // A cancelled tee waits for the delivered branch; never await it before delivery.
    context.finalize(() => cancellation)
  }
}

/** Observe explicit middleware responses; header-only edits do not turn a miss into a mock. */
function observeResponseAssignments<Route>(c: Context, state: Execution<Route>) {
  let prototype = Object.getPrototypeOf(c)
  let descriptor: PropertyDescriptor | undefined
  while (prototype && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(prototype, 'res')
    prototype = Object.getPrototypeOf(prototype)
  }
  if (!descriptor?.get || !descriptor.set) {
    throw new TypeError('Hono Context must expose the public res accessor.')
  }
  const { get, set } = descriptor
  Object.defineProperty(c, 'res', {
    configurable: true,
    get: () => get.call(c),
    set: (response: Response) => {
      const previous: Response = get.call(c)
      if (previous.body !== response.body) {
        discardBody(state.context, previous)
      }
      if (state.userActive) {
        state.overridden = true
        state.response = response
        response = middlewareResponse(state, response)
      }
      set.call(c, response)
    },
  })
}

/** One shared router, with each callback guarded by the session's exact selected rule. */
export function createRouteExecutor<Route extends ResolvedHttpRoute>(routes: readonly Route[], options: ResolvedRouteAppOptions<Route> = {}) {
  const app = new Hono({ router: new PatternRouter(), strict: false })
  const trackResponse = createHonoResponseBridge(app)
  const executions = new WeakMap<Request, Execution<Route>>()
  for (const route of routes) {
    const runMiddleware: MiddlewareHandler = async (c, next) => {
      const state = executions.get(c.req.raw)
      if (state?.route !== route) {
        return next()
      }
      observeResponseAssignments(c, state)
      const middleware = route.loadMiddlewares ? await route.loadMiddlewares() : route.middlewares ?? []
      const ordered = ['pre', 'normal', 'post'].flatMap(position => middleware.filter(entry => entry.position === position))
      const dispatch = async (index: number): Promise<void> => {
        const entry = ordered[index]
        if (!entry) {
          await next()
          return
        }
        let called = false
        const previous = state.userActive
        state.userActive = true
        try {
          const value: unknown = await entry.handle(c, async () => {
            if (called) {
              throw new Error('next() called multiple times')
            }
            called = true
            state.userActive = false
            try {
              await dispatch(index + 1)
            }
            finally {
              state.userActive = true
            }
          })
          const response = resolveResponse(value, c.res)
          const explicitResponse = isResponse(value) || (value && typeof value === 'object' && 'res' in value && isResponse(value.res))
          if (explicitResponse && (route.handlerType === 'http' || !c.finalized)) {
            state.overridden = true
            state.userActive = false
            state.response = response
            preserveHonoResponse(c, middlewareResponse(state, response))
          }
        }
        finally {
          state.userActive = previous
        }
      }
      await dispatch(0)
      if (route.handlerType === 'http' && !isResponse(state.result) && !state.overridden) {
        return c.res
      }
      if (state.errorResponse) {
        return c.res
      }
      if (route.delay && route.delay > 0) {
        await delay(route.delay, { signal: c.req.raw.signal })
      }
      const response = copyResponseCookies(state.response ?? c.res, applyContextResponseOverrides(c, c.res, route), route.headers ?? c.res.headers)
      if (options.onResponse) {
        void Promise.resolve().then(() => options.onResponse?.(route, response)).catch(() => {})
      }
      return trackResponse(c, response)
    }
    registerTokenRoute(app, route.method, route.tokens, [runMiddleware, async (c, next) => {
      const state = executions.get(c.req.raw)
      if (state?.route !== route) {
        return next()
      }
      // Legacy bodies belong to Hono's cache. The neutral runner only needs metadata.
      const request = route.handlerType === 'http'
        ? state.context.request
        : new Request(c.req.url, {
            method: c.req.method,
            headers: c.req.raw.headers,
            signal: c.req.raw.signal,
          })
      state.result = await state.resolve({ ...state.context, request, context: getHonoRequestContext(c).context })
      state.response = isResponse(state.result) ? state.result : undefined
      return isResponse(state.result)
        ? preserveHonoResponse(c, middlewareResponse(state, state.result))
        : new Response(null, { status: 204 })
    }])
  }
  app.onError((error) => {
    throw error
  })
  return {
    app: app as HonoApp,
    async resolve(route: Route, context: HttpResolverContext): Promise<HttpResolverReturn> {
      if (route.handlerType === 'http') {
        if (typeof route.handler !== 'function') {
          throw new TypeError('Native file handlers must be resolver functions.')
        }
        return (route.handler as HttpResolver)(context)
      }
      const c = (context.context as { hono: Context }).hono
      return normalizeValue(c, typeof route.handler === 'function' ? await route.handler(c) : route.handler)
    },
    async execute(route: Route, context: HttpResolverContext, resolve: Execution<Route>['resolve']): Promise<HttpResolverResult> {
      const state: Execution<Route> = { route, context, resolve, overridden: false, userActive: false }
      // Hono may consume its cached body; the standard resolver owns an independent body.
      const request = route.handlerType === 'http' ? context.request.clone() : context.request
      executions.set(request, state)
      const cancelResolvedBody = () => {
        if (isResponse(state.result)) {
          discardBody(context, state.result)
        }
      }
      context.request.signal.addEventListener('abort', cancelResolvedBody, { once: true })
      try {
        const response = await fetchHonoRouteApp(app, request, context.context)
        const result = state.errorResponse
          ?? (route.handlerType === 'http' && !isResponse(state.result) && !state.overridden ? state.result : response)
        if (isResponse(state.result) && (!isResponse(result) || result.body !== state.result.body)) {
          cancelResolvedBody()
        }
        return result
      }
      finally {
        context.request.signal.removeEventListener('abort', cancelResolvedBody)
        executions.delete(request)
      }
    },
  }
}
