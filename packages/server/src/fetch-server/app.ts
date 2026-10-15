import type { Hono } from '@mokup/shared/hono'
import type { resolvePlaygroundOptions } from '../dev/playground'
import type { RouteConfigInfo, RouteIgnoreInfo, RouteSkipInfo } from '../dev/scanner'
import type { Logger, MiddlewareHandler, ResolvedRoute, RouteTable } from '../dev/types'
import { Hono as HonoApp } from '@mokup/shared/hono'
import { createHonoApp } from '../dev/hono'
import { registerPlaygroundRoutes } from '../dev/playground'
import { normalizePlaygroundPath } from '../dev/playground/config'

type PlaygroundWsHandler = MiddlewareHandler<any, string, { outputFormat: 'ws' }>

function buildFetchServerApp(params: {
  routes: RouteTable
  disabledRoutes: RouteSkipInfo[]
  ignoredRoutes: RouteIgnoreInfo[]
  configFiles: RouteConfigInfo[]
  disabledConfigFiles: RouteConfigInfo[]
  dirs: string[]
  playground: ReturnType<typeof resolvePlaygroundOptions>
  root: string
  logger: Logger
  onResponse?: (route: ResolvedRoute, response: Response) => void | Promise<void>
  wsHandler?: PlaygroundWsHandler
}): Hono {
  const app = new HonoApp({ strict: false })
  if (params.wsHandler && params.playground.enabled) {
    const playgroundPath = normalizePlaygroundPath(params.playground.path)
    const routePrefix = playgroundPath === '/' ? '' : playgroundPath
    app.get(`${routePrefix}/ws`, params.wsHandler)
  }
  registerPlaygroundRoutes({
    app,
    routes: params.routes,
    disabledRoutes: params.disabledRoutes,
    ignoredRoutes: params.ignoredRoutes,
    configFiles: params.configFiles,
    disabledConfigFiles: params.disabledConfigFiles,
    dirs: params.dirs,
    logger: params.logger,
    config: params.playground,
    root: params.root,
  })
  if (params.routes.length > 0) {
    const mockAppOptions = params.onResponse ? { onResponse: params.onResponse } : {}
    const mockApp = createHonoApp(params.routes, mockAppOptions)
    app.route('/', mockApp)
  }
  return app
}

export { buildFetchServerApp }
