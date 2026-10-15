import type {
  Manifest,
  ManifestRoute,
  RouteToken,
  RuntimeOptions,
  RuntimeRequest,
  RuntimeResult,
} from '@mokup/runtime'
import type { Hono } from '@mokup/shared/hono'
import {
  createRuntime,
  createRuntimeApp,
  matchRouteTokens,
  normalizePathname,
  parseRouteTemplate,
  scoreRouteTokens,
} from '@mokup/runtime'
import { expectAssignable, expectType } from 'tsd'

const manifest: Manifest = {
  version: 1,
  routes: [],
}

const options: RuntimeOptions = {
  manifest,
}

const runtime = createRuntime(options)
expectType<(req: RuntimeRequest) => Promise<RuntimeResult | null>>(runtime.handle)
expectType<(req: Pick<RuntimeRequest, 'method' | 'path'>) => Promise<boolean>>(runtime.hasRoute)
expectType<Promise<boolean>>(runtime.hasRoute({ method: 'POST', path: '/api/ping' }))

const appPromise = createRuntimeApp(options)
expectType<Promise<Hono>>(appPromise)

const tokens: RouteToken[] = [{ type: 'static', value: 'users' }]
expectAssignable<number[]>(scoreRouteTokens(tokens))

const parsed = parseRouteTemplate('/users/[id]')
expectType<string[]>(parsed.errors)
expectType<string[]>(parsed.warnings)

expectType<string>(normalizePathname('/foo//'))
expectType<{ params: Record<string, string | string[]> } | null>(matchRouteTokens(tokens, '/users'))

const route: ManifestRoute = {
  method: 'GET',
  url: '/users',
  response: { type: 'json', body: { ok: true } },
}

expectType<ManifestRoute>(route)
