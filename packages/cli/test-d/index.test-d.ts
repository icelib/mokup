import type {
  BuildOptions,
  CheckDiagnostic,
  CheckOptions,
  CheckResult,
  DiagnosticCategory,
  DiagnosticErrorMode,
  HookErrorPolicy,
  MiddlewarePosition,
  MiddlewareRegistry,
  RouteDirectoryConfig,
  RouteRule,
} from '@mokup/cli'
import {
  buildManifest,
  checkManifest,
  createCli,
  defineConfig,
  onAfterAll,
  onBeforeAll,
  runCli,
} from '@mokup/cli'
import { expectAssignable, expectError, expectType } from 'tsd'

const options: BuildOptions = {
  dir: ['mock'],
  outDir: '.mokup',
  prefix: '/api',
  handlers: true,
  errorOn: ['duplicate-route'],
}
const diagnosticCategory: DiagnosticCategory = 'missing-handler'
const diagnosticErrorMode: DiagnosticErrorMode = [diagnosticCategory]

const routeRule: RouteRule = {
  handler: { ok: true },
  status: 200,
}

const directoryConfig: RouteDirectoryConfig = {
  headers: { 'x-mokup': 'dir' },
  enabled: true,
}

const registry: MiddlewareRegistry = {
  use: (...handlers: unknown[]) => {
    expectType<number>(handlers.length)
  },
}

const policy: HookErrorPolicy = 'warn'
const position: MiddlewarePosition = 'pre'

expectType<BuildOptions>(options)
expectAssignable<DiagnosticCategory>(diagnosticCategory)
expectAssignable<DiagnosticErrorMode>(diagnosticErrorMode)
expectType<RouteRule>(routeRule)
expectType<RouteDirectoryConfig>(directoryConfig)
expectType<MiddlewareRegistry>(registry)
expectAssignable<HookErrorPolicy>(policy)
expectAssignable<MiddlewarePosition>(position)

const configResult = defineConfig({})
expectAssignable<RouteDirectoryConfig | Promise<RouteDirectoryConfig>>(configResult)

onBeforeAll(() => {})
onAfterAll(async () => {})

const buildResult = buildManifest({ dir: 'mock', outDir: '.mokup' })
expectType<ReturnType<typeof buildManifest>>(buildResult)

expectType<ReturnType<typeof createCli>>(createCli())
expectType<Promise<void>>(runCli(['node', 'mokup']))

const checkOptions: CheckOptions = { dir: ['mock'], errorOn: ['duplicate-route'] }
expectType<Promise<CheckResult>>(checkManifest(checkOptions))
expectError(checkManifest({ outDir: '.mokup' }))
expectError(checkManifest({ handlers: false }))
const checkResult = await checkManifest({ errorOn: [] })
expectType<1>(checkResult.schemaVersion)
expectType<boolean>(checkResult.valid)
expectType<number>(checkResult.routeCount)
expectType<CheckDiagnostic[]>(checkResult.diagnostics)
