import type { ResolvedRouteApp, ResolvedRouteAppOptions } from '@mokup/runtime'
import type { ResolvedRoute, RouteTable } from './types'
import { createResolvedRouteApp } from '@mokup/runtime'

/** Build file-route HTTP definitions with a Hono compatibility adapter. */
export function createHonoApp(routes: RouteTable, options: ResolvedRouteAppOptions<ResolvedRoute> = {}): ResolvedRouteApp {
  return createResolvedRouteApp(routes, options)
}
