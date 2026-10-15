import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RouteTable } from '../../src/shared/types'
import type { WebpackCompilation, WebpackCompiler, WebpackDevMiddleware } from '../../src/webpack/plugin/types'
import { afterEach, beforeEach, expect, vi } from 'vitest'
import { createMokupWebpackPlugin } from '../../src/webpack/plugin'

const sharedMocks = vi.hoisted(() => ({
  scanRoutes: vi.fn(),
  bundleScript: vi.fn(),
  watch: vi.fn(),
  getHtmlHooks: vi.fn(),
  playgrounds: [] as Array<{ getRoutes: () => RouteTable }>,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() },
}))

export const mocks = sharedMocks

vi.mock('@mokup/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mokup/core')>()
  return {
    ...actual,
    scanRoutes: sharedMocks.scanRoutes,
    buildSwScript: ({ routes, root }: { routes: RouteTable, root: string }) => JSON.stringify({ root, routes: routes.map(route => route.template) }),
    createPlaygroundMiddleware: (params: { getRoutes: () => RouteTable }) => {
      sharedMocks.playgrounds.push(params)
      return (_req: IncomingMessage, _res: ServerResponse, next: () => void) => next()
    },
  }
})
vi.mock('../../src/webpack/plugin/bundle', () => ({ bundleScript: sharedMocks.bundleScript }))
vi.mock('@mokup/shared/chokidar', () => ({ default: { watch: sharedMocks.watch } }))
vi.mock('../../src/shared/logger', () => ({ createLogger: () => sharedMocks.logger }))
vi.mock('../../src/webpack/plugin/html', () => ({ resolveHtmlWebpackPlugin: () => ({ getHooks: sharedMocks.getHtmlHooks }) }))

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function hook<Args extends unknown[] = []>() {
  const handlers: Array<(...args: Args) => unknown> = []
  return {
    tap: vi.fn((_name: unknown, handler: (...args: Args) => unknown) => { handlers.push(handler) }),
    tapPromise: vi.fn((_name: unknown, handler: (...args: Args) => unknown) => { handlers.push(handler) }),
    async run(...args: Args) {
      for (const handler of handlers) {
        await handler(...args)
      }
    },
    call(...args: Args) {
      for (const handler of handlers) {
        handler(...args)
      }
    },
  }
}

export function compilerHarness(context = '/root/first', publicPath = '/') {
  const hooks = {
    beforeRun: hook(),
    watchRun: hook<[WebpackCompiler]>(),
    beforeCompile: hook(),
    thisCompilation: hook<[WebpackCompilation]>(),
    watchClose: hook(),
    shutdown: hook(),
  }
  const compiler = {
    context,
    options: { output: { publicPath, assetModuleFilename: 'assets/[name]' }, devServer: {} },
    hooks,
    watching: { invalidate: vi.fn<() => void>() },
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_ADDITIONS: 100 },
      sources: { RawSource: class {
        constructor(private value: string) {}
        source() { return this.value }
      } },
    },
  } as WebpackCompiler & { hooks: typeof hooks, watching: { invalidate: ReturnType<typeof vi.fn<() => void>> } }
  const setup = () => compiler.options.devServer?.setupMiddlewares?.([], {}) ?? []
  const compile = () => {
    const processAssets = hook()
    const alterAssetTagGroups = hook<[{ publicPath: string, headTags: unknown[] }]>()
    const assets = new Map<string, string>()
    const compilation: WebpackCompilation = {
      hooks: { processAssets },
      emitAsset: (name, source) => { assets.set(name, source.source()) },
      updateAsset: (name, source) => { assets.set(name, source.source()) },
      getAsset: name => assets.get(name),
      getAssetPath: name => name,
      outputOptions: { publicPath },
    }
    sharedMocks.getHtmlHooks.mockReturnValueOnce({ alterAssetTagGroups })
    hooks.thisCompilation.call(compilation)
    return {
      assets,
      emit: () => processAssets.run(),
      html: () => {
        const data = { publicPath, headTags: [] as unknown[] }
        alterAssetTagGroups.call(data)
        return data.headTags
      },
    }
  }
  return { compiler, hooks, setup, compile }
}

export function watcherHarness() {
  const handlers = new Map<string, (file: string) => void>()
  const watcher = {
    on: vi.fn((event: string, handler: (file: string) => void) => {
      handlers.set(event, handler)
      return watcher
    }),
    off: vi.fn((event: string, handler: (file: string) => void) => {
      if (handlers.get(event) === handler) {
        handlers.delete(event)
      }
      return watcher
    }),
    close: vi.fn(async () => {}),
    emit: (event: string, file = '/root/first/mock/ping.get.ts') => handlers.get(event)?.(file),
  }
  return watcher
}

export function route(url: string): RouteTable {
  return [{
    method: 'GET',
    template: url,
    file: `/root/mock${url}.get.ts`,
    tokens: [{ type: 'static', value: url.slice(1) }],
    score: [4],
    handler: { url },
  }]
}

export function plugin() {
  return createMokupWebpackPlugin({ entries: { dir: 'mock', mode: 'sw', log: false }, playground: { enabled: true } })
}

export async function start(harness: ReturnType<typeof compilerHarness>, instance = plugin()) {
  instance.apply(harness.compiler)
  await harness.hooks.watchRun.run(harness.compiler)
  const middlewares = harness.setup()
  await harness.hooks.beforeCompile.run()
  return middlewares
}

export async function requestSw(middlewares: WebpackDevMiddleware[], path = '/mokup-sw.js') {
  const sw = middlewares.find(entry => entry.name === 'mokup-sw')!
  const next = vi.fn()
  const response = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() }
  await sw.middleware({ url: path } as IncomingMessage, response as unknown as ServerResponse, next)
  return { next, response }
}

export async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve()
  }
}

export function lifecycleSuite() {
  const compilers: Array<ReturnType<typeof compilerHarness>> = []
  const watchers: Array<ReturnType<typeof watcherHarness>> = []
  const cleanupFailures = new Set<ReturnType<typeof compilerHarness>>()
  const compiler = (...args: Parameters<typeof compilerHarness>) => {
    const harness = compilerHarness(...args)
    compilers.push(harness)
    return harness
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.playgrounds.length = 0
    compilers.length = 0
    watchers.length = 0
    cleanupFailures.clear()
    mocks.scanRoutes.mockImplementation(async () => route('/initial'))
    mocks.bundleScript.mockImplementation(async ({ code }: { code: string }) => code)
    mocks.watch.mockImplementation(() => {
      const watcher = watcherHarness()
      watchers.push(watcher)
      return watcher
    })
  })
  afterEach(async () => {
    try {
      for (const harness of compilers) {
        harness.hooks.watchClose.call()
        if (cleanupFailures.has(harness)) {
          await expect(harness.hooks.shutdown.run()).rejects.toThrow('Failed to close mokup')
        }
        else {
          await harness.hooks.shutdown.run()
        }
      }
    }
    finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
  return { compiler, watchers, cleanupFailures }
}
