import type {
  ControlledFetchHandler,
  DiagnosticCategory,
  DiagnosticErrorMode,
  FetchHandler,
  Manifest,
  RouteDirectoryConfig,
  RouteRule,
  ServerOptions,
  WorkerBundle,
  WorkerInput,
} from '@mokup/server'
import type { FetchServer, FetchServerOptionsInput, NodeWorkerInput } from '@mokup/server/node'
import {
  createFetchHandler,
  createMokupWorker,
  defineConfig,
  onAfterAll,
  onBeforeAll,
} from '@mokup/server'
import {
  createAstroEndpoint,
  createConnectMiddleware,
  createExpressMiddleware,
  createFetchServer,
  createHonoMiddleware,
  createKoaMiddleware,
  createNextRouteHandler,
  createMokupWorker as createNodeWorker,
  createNuxtHandler,
} from '@mokup/server/node'
import { expectAssignable, expectType } from 'tsd'

const manifest: Manifest = { version: 1, routes: [] }
const diagnosticCategory: DiagnosticCategory = 'missing-handler'
const diagnosticErrorMode: DiagnosticErrorMode = [diagnosticCategory]

const serverOptions: ServerOptions = {
  manifest,
}

const handler = createFetchHandler(serverOptions)
expectType<ControlledFetchHandler>(handler)
expectAssignable<FetchHandler>(handler)
expectType<AbortSignal>(handler.signal)
void handler.ready().then(session => expectType<AbortSignal>(session.signal))

const workerBundle: WorkerBundle = {
  manifest,
}
const workerInput: WorkerInput = workerBundle
expectAssignable<WorkerInput>(workerInput)

const worker = createMokupWorker(workerInput)
expectAssignable<{ fetch: (request: Request) => Promise<Response> }>(worker)
void worker.ready().then(session => expectType<AbortSignal>(session.signal))

const nodeWorkerInput: NodeWorkerInput = workerBundle
const nodeWorker = createNodeWorker(nodeWorkerInput)
expectAssignable<{ fetch: (request: Request) => Promise<Response> }>(nodeWorker)
expectType<Promise<void>>(nodeWorker.close())

const configResult = defineConfig({ headers: { 'x-mokup': 'dev' } })
expectAssignable<RouteDirectoryConfig | Promise<RouteDirectoryConfig>>(configResult)

const rule: RouteRule = {
  handler: { ok: true },
  status: 200,
}
expectType<RouteRule>(rule)

onBeforeAll(() => {})
onAfterAll(async () => {})

const connectMiddleware = createConnectMiddleware(serverOptions)
expectType<ReturnType<typeof createConnectMiddleware>>(connectMiddleware)
expectType<AbortSignal>(connectMiddleware.signal)
expectType<Promise<void>>(connectMiddleware.close())

expectType<ReturnType<typeof createExpressMiddleware>>(
  createExpressMiddleware(serverOptions),
)
expectType<ReturnType<typeof createHonoMiddleware>>(
  createHonoMiddleware(serverOptions),
)
expectType<ReturnType<typeof createKoaMiddleware>>(
  createKoaMiddleware(serverOptions),
)
expectType<ReturnType<typeof createNextRouteHandler>>(
  createNextRouteHandler(serverOptions),
)
expectType<ReturnType<typeof createNuxtHandler>>(
  createNuxtHandler(serverOptions),
)
expectType<ReturnType<typeof createAstroEndpoint>>(
  createAstroEndpoint(serverOptions),
)

const fetchServerOptions: FetchServerOptionsInput = {
  entries: { dir: 'mock', errorOn: ['invalid-route'] },
}
const fetchServer = createFetchServer(fetchServerOptions)
expectType<Promise<FetchServer>>(fetchServer)
expectAssignable<DiagnosticCategory>(diagnosticCategory)
expectAssignable<DiagnosticErrorMode>(diagnosticErrorMode)
