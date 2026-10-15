import { resolveSwConfig } from '@mokup/core'
import { Hono } from '@mokup/shared/hono'
import { describe, expect, it, vi } from 'vitest'
import { configureDevServer, configurePreviewServer } from '../src/vite/plugin/server-hooks'

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

describe('vite server hooks', () => {
  it('configures dev server middleware', async () => {
    const server = createServerStub()
    const state = {
      routes: [],
      serverRoutes: [{ file: '/root/mock/ping.get.json', template: '/api/ping', method: 'GET', tokens: [], score: [], handler: { ok: true } }],
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
      playgroundConfig: { path: '/__mokup', enabled: true, build: false },
      playgroundMiddleware: (_req, _res, next) => next(),
      swConfig,
      enableViteMiddleware: false,
      refreshRoutes: async () => {},
      resolveAllDirs: () => ['/root/mock'],
      watchEnabled: false,
    })

    expect(server.middlewares.stack.length).toBeGreaterThan(0)
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
    expect(res.statusCode).toBe(200)
    expect(res.end).toHaveBeenCalled()
  })

  it('passes through when SW path does not match', async () => {
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
    const next = vi.fn()
    await swMiddleware?.({ url: '/not-sw.js' }, { setHeader: vi.fn(), end: vi.fn() }, next)
    expect(next).toHaveBeenCalled()
  })

  it('passes preview SW requests to downstream static middleware', async () => {
    const server = createServerStub()
    const closeListeners: Array<() => void> = []
    server.httpServer = { once: (_event: string, handler: () => void) => closeListeners.push(handler) } as any

    const state = {
      routes: [],
      serverRoutes: [{ file: '/root/mock/ping.get.json', template: '/api/ping', method: 'GET', tokens: [], score: [], handler: { ok: true } }],
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
      playgroundConfig: { path: '/__mokup', enabled: true, build: false },
      playgroundMiddleware: (_req, _res, next) => next(),
      swConfig,
      enableViteMiddleware: false,
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
  })
})
