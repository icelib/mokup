import type { HttpHandler, HttpResponseResolver, StrictRequest } from '@mokup/msw'
import { http, HttpMethods, HttpResponse } from '@mokup/msw'
import { setupWorker } from '@mokup/msw/browser'
import { setupServer } from '@mokup/msw/node'
import { http as foreignHttp } from 'msw/http'
import { expectAssignable, expectError, expectType } from 'tsd'

const handler = http.get('/users/:id', ({ request, params }) => {
  expectAssignable<Request>(request)
  return HttpResponse.json({ id: params['id'] })
})
expectAssignable<HttpHandler>(handler)
expectType<'GET'>(HttpMethods.GET)
const resolver: HttpResponseResolver<{ id: string }, never, { ok: boolean }> = ({ request, params }) => {
  expectType<StrictRequest<never>>(request)
  expectType<string>(params.id)
  return HttpResponse.json({ ok: true })
}
expectAssignable<HttpHandler>(http.get('/users/:id', resolver))
const server = setupServer(handler)
server.events.on('request:start', (event) => {
  expectType<Request>(event.request)
  expectType<string>(event.requestId)
})
server.events.on('response:mocked', (event) => {
  expectType<Request>(event.request)
  expectType<Response>(event.response)
})
server.use(foreignHttp.get('https://api.example.test/users', () => new Response('foreign')))
server.resetHandlers(foreignHttp.all('*', () => new Response('foreign all')))
expectType<void>(server.listen({ onUnhandledRequest: 'error' }))
expectType<Promise<void>>(server.close())
expectType<void>(server.listen({ onUnhandledRequest: (request, print) => {
  expectType<Request>(request)
  expectType<void>(print.warning())
} }))
expectType<void>(server.listen({ onUnhandledFrame: 'error' }))
expectType<void>(server.listen({ onUnhandledFrame: ({ frame, defaults }) => {
  expectType<'http'>(frame.protocol)
  expectType<Request>(frame.data.request)
  expectType<void>(defaults.warn())
} }))
const worker = setupWorker(handler)
expectType<'interceptor' | 'serviceWorker'>(worker.mode)
expectType<Promise<void>>(worker.start({ onUnhandledRequest: 'warn' }))
expectType<Promise<void>>(worker.stop())
expectType<Promise<void>>(worker.start({ serviceWorker: { url: '/mockServiceWorker.js' } }))
expectError(worker.start({ quiet: true }))
