import type { Context } from '@mokup/shared/hono'
import { applyContextResponseOverrides, applyResponseOverrides } from '@mokup/shared/response-overrides'
import { expectType } from 'tsd'

expectType<Response>(applyResponseOverrides(new Response('payload'), { status: 204 }))
expectType<Response>(applyResponseOverrides(new Response('payload'), { headers: { 'x-test': 'yes' } }))
expectType<Response>(applyResponseOverrides(new Response('payload'), {}, 'HEAD'))
declare const context: Context
expectType<Response>(applyContextResponseOverrides(context, context.res, { status: 204 }))
