import type { createConnectMiddleware } from '@mokup/server/connect'
import type { createFastifyPlugin } from '@mokup/server/fastify'
import type { createKoaMiddleware } from '@mokup/server/koa'
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type Koa from 'koa'
import type { ServerResponse } from 'node:http'
import { expectAssignable, expectType } from 'tsd'

type NodeResponse = Parameters<ReturnType<typeof createConnectMiddleware>>[1]
type KoaContext = Parameters<ReturnType<typeof createKoaMiddleware>>[0]
type FastifyInstanceLike = Parameters<ReturnType<typeof createFastifyPlugin>>[0]

declare const nativeResponse: ServerResponse
declare const nativeContext: Koa.Context
declare const response: NodeResponse
declare const context: KoaContext
declare const nativeFastify: FastifyInstance
declare const fastifyPlugin: ReturnType<typeof createFastifyPlugin>

expectAssignable<NodeResponse>(nativeResponse)
expectAssignable<KoaContext>(nativeContext)
expectAssignable<FastifyInstanceLike>(nativeFastify)
expectAssignable<FastifyPluginAsync>(fastifyPlugin)
nativeFastify.register(fastifyPlugin)
expectType<(name: string, value: string) => void>(response.setHeader)
expectType<((name: string, value: string) => void) | undefined>(response.appendHeader)
expectType<(headers: Record<string, string>) => void>(context.set)
expectType<((name: string, value: string) => void) | undefined>(context.append)

expectAssignable<NodeResponse>({
  setHeader: (_name: string, _value: string) => {},
  end: () => {},
})
expectAssignable<KoaContext>({
  req: { on: (_event: string, _listener: (...args: unknown[]) => void) => {} },
  set: (_headers: Record<string, string>) => {},
})
expectAssignable<FastifyInstanceLike>({
  addHook: (_name: 'onRequest', _handler: Parameters<FastifyInstanceLike['addHook']>[1]) => {},
})
