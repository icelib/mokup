import type { Hono as HonoApp, MiddlewareHandler } from '@mokup/shared/hono'
import type { HttpHandler, HttpScenario, MockSession, UnhandledRequestPolicy } from './http/types'
import type { RouteToken } from './router'
import { prioritizeHeadRoutes } from '@mokup/shared/head-routes'
import { getPath, Hono, PatternRouter } from '@mokup/shared/hono'
import { getHonoRequestContext } from './hono-context'
import { createHonoResponseBridge, preserveHonoResponse } from './hono-response'
import { http } from './http/handlers'
import { createUrlPredicate } from './http/matcher'
import { createMockSession } from './http/session'
import { createRouteExecutor } from './route-executor'
import { exposeFileParams } from './route-params'
import { matchRouteTokens } from './router'

/** Structural file-route boundary shared by scanners and deployed runtimes. */
export interface ResolvedHttpRoute {
  method: string
  tokens: RouteToken[]
  handler: unknown
  handlerType?: 'hono' | 'http'
  once?: boolean
  middlewares?: { handle: MiddlewareHandler, position: 'pre' | 'normal' | 'post' }[]
  /** Lazy module middleware remains outside the persistent resolver sequence. */
  loadMiddlewares?: () => Promise<NonNullable<ResolvedHttpRoute['middlewares']>>
  status?: number
  headers?: Record<string, string>
  delay?: number
}

export interface ResolvedRouteApp extends HonoApp {
  readonly mockSession: MockSession
}

export interface ResolvedRouteAppOptions<Route extends ResolvedHttpRoute = ResolvedHttpRoute> {
  session?: MockSession
  handlers?: readonly HttpHandler[]
  onUnhandled?: UnhandledRequestPolicy
  scenario?: HttpScenario
  onResponse?: (route: Route, response: Response) => void | Promise<void>
}

const unhandledRequests = new WeakSet<Request>()

/** A transport can distinguish session fallthrough from an intentional HTTP 404. */
export function takeRouteSessionMiss(request: Request): boolean {
  return unhandledRequests.delete(request)
}

function compileRoutes<Route extends ResolvedHttpRoute>(routes: readonly Route[], options: ResolvedRouteAppOptions<Route>) {
  const snapshot = routes.map(route => Object.freeze({
    ...route,
    tokens: Object.freeze(route.tokens.map(token => Object.freeze({ ...token }))),
    ...(route.headers ? { headers: Object.freeze({ ...route.headers }) } : {}),
    ...(route.middlewares ? { middlewares: Object.freeze(route.middlewares.map(entry => Object.freeze({ ...entry }))) } : {}),
  }) as Route)
  const ordered = prioritizeHeadRoutes(snapshot)
  const executor = createRouteExecutor(ordered, options)
  const handlers = ordered.map(route => Object.freeze({ ...http.all(createUrlPredicate((request) => {
    const method = request.method.toUpperCase()
    if (method !== route.method && !(method === 'HEAD' && route.method === 'GET')) {
      return null
    }
    return matchRouteTokens(route.tokens, getPath(request))?.params ?? null
  }), context => executor.resolve(route, context), { once: route.once ?? false }), execute: (context, resolve) => executor.execute(route, context, resolve) } satisfies HttpHandler))
  return { handlers, snapshot: ordered }
}

/** Compile resolved file routes to the same immutable HTTP definitions as manifest routes. */
export function compileResolvedRouteHandlers<Route extends ResolvedHttpRoute>(routes: readonly Route[], options: ResolvedRouteAppOptions<Route> = {}): HttpHandler[] {
  return compileRoutes(routes, options).handlers
}

/** Hono remains a compatibility adapter; Fetch dispatch belongs to the shared session. */
export function createResolvedRouteApp<Route extends ResolvedHttpRoute>(routes: readonly Route[], options: ResolvedRouteAppOptions<Route> = {}): ResolvedRouteApp {
  const { handlers, snapshot } = compileRoutes(routes, options)
  const app = new Hono({ router: new PatternRouter(), strict: false })
  const trackResponse = createHonoResponseBridge(app)
  const session = options.session ?? createMockSession({ ...(options.scenario ? { scenario: options.scenario } : {}) })
  session.replaceInitialHandlers(...options.handlers ?? [], ...handlers)
  if (options.onUnhandled) {
    session.setOnUnhandled(options.onUnhandled)
  }
  // Keep the session in a registered route so parent.route() cannot bypass it.
  app.all('*', async (c, next) => {
    unhandledRequests.delete(c.req.raw)
    exposeFileParams(c, snapshot)
    const terminal = c.req.routeIndex === c.req.matchedRoutes.length - 1
    const response = await session.handle(c.req.raw, getHonoRequestContext(c))
    if (response) {
      return trackResponse(c, preserveHonoResponse(c, response))
    }
    await next()
    if (terminal) {
      unhandledRequests.add(c.req.raw)
    }
  })
  app.onError((error) => {
    throw error
  })
  return Object.assign(app, { mockSession: session })
}

export function getRouteSession(app: HonoApp | null): MockSession | undefined {
  return app && 'mockSession' in app ? (app as ResolvedRouteApp).mockSession : undefined
}
