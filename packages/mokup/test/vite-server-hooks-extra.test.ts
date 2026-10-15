import { resolveSwConfig } from '@mokup/core'
import { Hono } from '@mokup/shared/hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { configureDevServer, configurePreviewServer } from '../src/vite/plugin/server-hooks'

const watcherMocks = vi.hoisted(() => ({
  setupViteWatchers: vi.fn(),
  setupPreviewWatchers: vi.fn(() => ({ close: vi.fn() })),
}))

const middlewareMocks = vi.hoisted(() => ({
  createMiddleware: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
}))

const swMocks = vi.hoisted(() => ({
  buildSwScript: vi.fn(() => 'self.skipWaiting()'),
}))

vi.mock('../src/vite/plugin/watcher', () => watcherMocks)
vi.mock('@mokup/core', async () => {
  const actual = await vi.importActual<typeof import('@mokup/core')>('@mokup/core')
  return {
    ...actual,
    createMiddleware: middlewareMocks.createMiddleware,
    buildSwScript: swMocks.buildSwScript,
  }
})

function createServerStub() {
  const stack: Array<{ route: string, handle: (req: any, res: any, next: () => void) => void }> = []
  const middlewares = {
    stack,
    use: (handler: (req: any, res: any, next: () => void) => void) => {
      stack.push({ route: '', handle: handler })
    },
  }
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() }
  return {
    middlewares,
    watcher: {
      add: vi.fn(),
      on: vi.fn(),
    },
    ws: { send: vi.fn() },
    config: { root: '/root', logger },
    resolvedUrls: { local: ['http://localhost:5173/'] },
    printUrls: () => {
      logger.info('  ➜  Local:   http://localhost:5173/')
    },
  }
}

async function findSwMiddleware(
  stack: Array<{ handle: (req: any, res: any, next: () => void) => void }>,
) {
  for (const entry of stack) {
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader: (name: string, value: string) => {
        res.headers[name.toLowerCase()] = value
      },
      end: vi.fn(),
    }
    const next = vi.fn()
    await entry.handle({ url: '/mokup-sw.js' }, res, next)
    if (res.statusCode !== 0 || res.end.mock.calls.length > 0) {
      return entry.handle
    }
  }
  return undefined
}

describe('vite server hooks extra coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    middlewareMocks.createMiddleware.mockImplementation(() => (_req: any, _res: any, next: () => void) => next())
    watcherMocks.setupPreviewWatchers.mockImplementation(() => ({ close: vi.fn() }))
    swMocks.buildSwScript.mockImplementation(() => 'self.skipWaiting()')
  })

  it('returns 500 when sw generation fails', async () => {
    swMocks.buildSwScript.mockImplementation(() => {
      throw new Error('boom')
    })

    const server = createServerStub()
    const state = {
      routes: [],
      serverRoutes: [],
      swRoutes: [{ file: '/root/mock/ping.get.json', template: '/api/ping', method: 'GET', tokens: [], score: [], handler: { ok: true } }],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: new Hono(),
      lastSignature: null,
      swModuleVersion: 0,
    }
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), log: vi.fn() }
    const swConfig = resolveSwConfig([{ dir: '/root/mock', prefix: '/api', mode: 'sw' }], logger)

    await configureDevServer({
      server: server as any,
      state,
      root: '/root',
      base: '/',
      logger,
      playgroundConfig: { path: '/__mokup', enabled: false, build: false },
      playgroundMiddleware: (_req, _res, next) => next(),
      swConfig,
      enableViteMiddleware: false,
      refreshRoutes: async () => {},
      resolveAllDirs: () => ['/root/mock'],
      watchEnabled: false,
    })

    const swMiddleware = await findSwMiddleware(server.middlewares.stack)
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader: (name: string, value: string) => {
        res.headers[name.toLowerCase()] = value
      },
      end: vi.fn(),
    }
    await swMiddleware?.({ url: '/mokup-sw.js' }, res, vi.fn())
    expect(res.statusCode).toBe(500)
    expect(logger.error).toHaveBeenCalled()
  })

  it('enables vite middleware and watchers when configured', async () => {
    const server = createServerStub()
    const state = {
      routes: [],
      serverRoutes: [{ file: '/root/mock/ping.get.json', template: '/api/ping', method: 'GET', tokens: [], score: [], handler: { ok: true } }],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: new Hono(),
      lastSignature: null,
      swModuleVersion: 0,
    }
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), log: vi.fn() }

    await configureDevServer({
      server: server as any,
      state,
      root: '/root',
      base: '/',
      logger,
      playgroundConfig: { path: '/__mokup', enabled: false, build: false },
      playgroundMiddleware: (_req, _res, next) => next(),
      swConfig: null,
      enableViteMiddleware: true,
      refreshRoutes: async () => {},
      resolveAllDirs: () => ['/root/mock'],
      watchEnabled: true,
    })

    expect(middlewareMocks.createMiddleware).toHaveBeenCalled()
    expect(watcherMocks.setupViteWatchers).toHaveBeenCalled()
    const getApp = middlewareMocks.createMiddleware.mock.calls[0]?.[0]
    expect(getApp?.()).toBe(state.app)
    const refresh = watcherMocks.setupViteWatchers.mock.calls[0]?.[0]?.refresh
    await refresh?.()
  })

  it('configures preview watchers when enabled', async () => {
    const server = createServerStub()
    server.httpServer = { once: vi.fn() } as any
    const state = {
      routes: [],
      serverRoutes: [],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: new Hono(),
      lastSignature: null,
      swModuleVersion: 0,
    }
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), log: vi.fn() }

    const watcher = await configurePreviewServer({
      server: server as any,
      state,
      root: '/root',
      base: '/',
      logger,
      playgroundConfig: { path: '/__mokup', enabled: false, build: false },
      playgroundMiddleware: (_req, _res, next) => next(),
      swConfig: null,
      enableViteMiddleware: false,
      refreshRoutes: async () => {},
      resolveAllDirs: () => ['/root/mock'],
      watchEnabled: true,
    })

    expect(watcherMocks.setupPreviewWatchers).toHaveBeenCalled()
    expect(watcher).not.toBeNull()
    const refresh = watcherMocks.setupPreviewWatchers.mock.calls[0]?.[0]?.refresh
    await refresh?.()
  })

  it('registers preview middleware when enabled', async () => {
    const server = createServerStub()
    server.httpServer = { once: vi.fn() } as any
    const state = {
      routes: [],
      serverRoutes: [{ file: '/root/mock/ping.get.json', template: '/api/ping', method: 'GET', tokens: [], score: [], handler: { ok: true } }],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: new Hono(),
      lastSignature: null,
      swModuleVersion: 0,
    }
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), log: vi.fn() }

    await configurePreviewServer({
      server: server as any,
      state,
      root: '/root',
      base: '/',
      logger,
      playgroundConfig: { path: '/__mokup', enabled: false, build: false },
      playgroundMiddleware: (_req, _res, next) => next(),
      swConfig: null,
      enableViteMiddleware: true,
      refreshRoutes: async () => {},
      resolveAllDirs: () => ['/root/mock'],
      watchEnabled: false,
    })

    const getApp = middlewareMocks.createMiddleware.mock.calls.at(-1)?.[0]
    expect(getApp?.()).toBe(state.app)
  })

  it('keeps preview SW requests untouched even when source generation would fail', async () => {
    swMocks.buildSwScript.mockImplementation(() => {
      throw new Error('boom')
    })

    const server = createServerStub()
    const state = {
      routes: [],
      serverRoutes: [],
      swRoutes: [{ file: '/root/mock/ping.get.json', template: '/api/ping', method: 'GET', tokens: [], score: [], handler: { ok: true } }],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: new Hono(),
      lastSignature: null,
      swModuleVersion: 0,
    }
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), log: vi.fn() }
    const swConfig = resolveSwConfig([{ dir: '/root/mock', prefix: '/api', mode: 'sw' }], logger)

    await configurePreviewServer({
      server: server as any,
      state,
      root: '/root',
      base: '/',
      logger,
      playgroundConfig: { path: '/__mokup', enabled: false, build: false },
      playgroundMiddleware: (_req, _res, next) => next(),
      swConfig,
      enableViteMiddleware: true,
      refreshRoutes: async () => {},
      resolveAllDirs: () => ['/root/mock'],
      watchEnabled: false,
    })

    const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() }
    for (const entry of server.middlewares.stack) {
      const next = vi.fn()
      await entry.handle({ url: '/mokup-sw.js' }, res, next)
      expect(next).toHaveBeenCalledExactlyOnceWith()
    }
    expect(res.statusCode).toBe(0)
    expect(res.setHeader).not.toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
    expect(swMocks.buildSwScript).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    expect(middlewareMocks.createMiddleware).toHaveBeenCalledOnce()
  })
})
