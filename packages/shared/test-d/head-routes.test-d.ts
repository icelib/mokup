import { isHeadFallbackHandler, prioritizeHeadRoutes, registerHonoRoute } from '@mokup/shared/head-routes'
import { Hono } from '@mokup/shared/hono'
import { registerTokenRoute } from '@mokup/shared/hono-routes'
import { expectType } from 'tsd'

const app = new Hono()
registerHonoRoute(app, 'HEAD', '/items/:id', [async c => c.text(c.req.param('id') ?? '')])
expectType<boolean>(isHeadFallbackHandler(c => c.text('get')))
expectType<Array<{ method: string, path: string }>>(prioritizeHeadRoutes([{ method: 'HEAD', path: '/items' }]))
expectType<void>(registerTokenRoute(app, 'GET', [{ type: 'param', name: 'user-id' }], [async c => c.text(c.req.param('user-id') ?? '')]))
