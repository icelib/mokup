import type {
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
  createConnectMiddleware,
  createExpressMiddleware,
  createFetchServer,
  createHonoMiddleware,
  createKoaMiddleware,
  createMokupWorker as createNodeWorker,
} from '@mokup/server/node'
import { expectAssignable, expectType } from 'tsd'

const manifest: Manifest = { version: 1, routes: [] }
const diagnosticCategory: DiagnosticCategory = 'missing-handler'
const diagnosticErrorMode: DiagnosticErrorMode = [diagnosticCategory]

const serverOptions: ServerOptions = {
  manifest,
}

const handler = createFetchHandler(serverOptions)
expectType<FetchHandler>(handler)

const workerBundle: WorkerBundle = {
  manifest,
}
const workerInput: WorkerInput = workerBundle
expectAssignable<WorkerInput>(workerInput)

const worker = createMokupWorker(workerInput)
expectType<{ fetch: (request: Request) => Promise<Response> }>(worker)

const nodeWorkerInput: NodeWorkerInput = workerBundle
const nodeWorker = createNodeWorker(nodeWorkerInput)
expectType<{ fetch: (request: Request) => Promise<Response> }>(nodeWorker)

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

expectType<ReturnType<typeof createExpressMiddleware>>(
  createExpressMiddleware(serverOptions),
)
expectType<ReturnType<typeof createHonoMiddleware>>(
  createHonoMiddleware(serverOptions),
)
expectType<ReturnType<typeof createKoaMiddleware>>(
  createKoaMiddleware(serverOptions),
)

const fetchServerOptions: FetchServerOptionsInput = {
  entries: { dir: 'mock', errorOn: ['invalid-route'] },
}
const fetchServer = createFetchServer(fetchServerOptions)
expectType<Promise<FetchServer>>(fetchServer)
expectAssignable<DiagnosticCategory>(diagnosticCategory)
expectAssignable<DiagnosticErrorMode>(diagnosticErrorMode)
