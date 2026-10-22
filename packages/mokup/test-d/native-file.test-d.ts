import type { FileRouteRule, RouteRule } from 'mokup'
import { defineHandler, defineHttpHandler } from 'mokup'
import { HttpResponse } from 'mokup/http'
import { expectAssignable, expectType } from 'tsd'

const native = defineHttpHandler<{ id: string }, { name: string }, { id: string }>(async ({ params, request }) => {
  expectType<string>(params.id)
  expectType<{ name: string }>(await request.json())
  return HttpResponse.json({ id: params.id })
}, { once: true })
expectAssignable<FileRouteRule>(native)
expectAssignable<RouteRule>(defineHandler({ handler: c => c.json({ url: c.req.url }), once: true }))
expectAssignable<FileRouteRule[]>([defineHandler({ handler: c => c.text('legacy') }), native])
