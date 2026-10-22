import type { HttpHandler, HttpRouteRule, StrictResponse } from '@mokup/runtime/http'
import { defineHttpHandler, http, HttpResponse } from '@mokup/runtime/http'
import { expectAssignable, expectError, expectType } from 'tsd'

interface Params { id: string }
interface Input { name: string }
interface Output { id: string, name: string }

const handler = http.post<Params, Input, Output>('/users/:id', async ({ params, request }) => {
  expectType<string>(params.id)
  const body = await request.json()
  expectType<Input>(body)
  return HttpResponse.json<Output>({ id: params.id, name: body.name })
})
expectAssignable<HttpHandler>(handler)
expectType<Promise<Output>>(HttpResponse.json<Output>({ id: '1', name: 'Ada' }).json())
expectAssignable<StrictResponse<Output>>(HttpResponse.json<Output>({ id: '1', name: 'Ada' }))
expectError(HttpResponse.json<Output>({ name: 'missing id' }))
expectError(http.get<Params, never, Output>('/users/:id', () => HttpResponse.json({ id: 123, name: 'wrong type' })))
expectError(http.get<Params, never, Output>('/users/:id', () => new Response('untyped')))
expectAssignable<HttpHandler>(http.get('/plain', () => new Response('native')))
expectAssignable<HttpHandler>(http.get<{ segment: string[] }>('/files/:segment/:segment', ({ params }) => {
  expectType<string[]>(params.segment)
  return HttpResponse.json(params.segment)
}))
expectAssignable<HttpHandler>(http.get<Params, never, Output>('/users/:id', function* ({ params }) {
  yield HttpResponse.json({ id: params.id, name: 'first' })
  return HttpResponse.json({ id: params.id, name: 'last' })
}))
expectType<HttpRouteRule>(defineHttpHandler<Params, Input, Output>(async ({ params, request }) => {
  expectType<string>(params.id)
  expectType<Input>(await request.json())
  return HttpResponse.json({ id: params.id, name: 'typed' })
}, { once: true, status: 201 }))
expectError(defineHttpHandler<Params, Input, Output>(() => HttpResponse.json({ id: 1, name: 'wrong' })))
expectError(defineHttpHandler<Params, Input, Output>(() => new Response('untyped')))
expectError(defineHttpHandler(() => ({ body: 'plain object' })))
