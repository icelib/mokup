import type {
  DiagnosticCategory,
  DiagnosticErrorMode,
  Logger,
  ResolvedRoute,
  ResolvedSwConfig,
  RouteDecisionStep,
  RouteIgnoreInfo,
  RouteSkipInfo,
  RouteTable,
  VitePluginOptions,
} from '@mokup/core'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  buildBundleModule,
  createHonoApp,
  createMiddleware,
  defaultSwPath,
  defaultSwScope,
  resolveSwConfig,
  resolveSwUnregisterConfig,
  scanRoutes,
} from '@mokup/core'
import { expectAssignable, expectType } from 'tsd'

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  log: () => {},
}
const diagnosticCategory: DiagnosticCategory = 'invalid-route'
const diagnosticErrorMode: DiagnosticErrorMode = [diagnosticCategory]

const route: ResolvedRoute = {
  file: 'mock/ping.get.ts',
  template: '/ping',
  method: 'GET',
  tokens: [{ type: 'static', value: 'ping' }],
  score: [4],
  handler: () => ({ ok: true }),
}

const routes: RouteTable = [route]

const skipInfo: RouteSkipInfo = {
  file: 'mock/disabled.get.ts',
  reason: 'disabled',
}

const ignoreInfo: RouteIgnoreInfo = {
  file: 'mock/readme.md',
  reason: 'unsupported',
}

const decision: RouteDecisionStep = {
  step: 'config.enabled',
  result: 'pass',
}

expectType<RouteSkipInfo>(skipInfo)
expectType<RouteIgnoreInfo>(ignoreInfo)
expectType<RouteDecisionStep>(decision)

const app = createHonoApp(routes)
expectType<ReturnType<typeof createHonoApp>>(app)

const middleware = createMiddleware(() => app, logger)
expectAssignable<(
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => Promise<void>>(middleware)

const bundleSource = buildBundleModule({ routes, root: '/' })
expectType<string>(bundleSource)

const scanResult = scanRoutes({ dirs: [], prefix: '', logger })
expectType<Promise<RouteTable>>(scanResult)

const swEntry: VitePluginOptions = { dir: 'mock', mode: 'sw' }
const swConfig = resolveSwConfig([swEntry], logger)
expectType<ResolvedSwConfig | null>(swConfig)

const swUnregister = resolveSwUnregisterConfig([swEntry], logger)
expectType<ResolvedSwConfig>(swUnregister)

expectAssignable<string>(defaultSwPath)
expectAssignable<string>(defaultSwScope)
expectAssignable<DiagnosticCategory>(diagnosticCategory)
expectAssignable<DiagnosticErrorMode>(diagnosticErrorMode)
