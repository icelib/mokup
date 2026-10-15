import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ViteDevServer } from 'vite'
import type { MiddlewareHandler } from '../src/vite/plugin/middleware'
import type { PluginState } from '../src/vite/plugin/state'
import type { WebpackBuildSnapshot } from '../src/webpack/plugin/session'
import { resolveSwConfig } from '@mokup/core'
import { describe, expect, it, vi } from 'vitest'
import { configureDevServer } from '../src/vite/plugin/server-hooks'
import { createWebpackBuildSession } from '../src/webpack/plugin/session'
import { createSwMiddleware } from '../src/webpack/plugin/sw-middleware'

async function viteMiddleware(): Promise<MiddlewareHandler> {
  const handlers: MiddlewareHandler[] = []
  const server = {
    config: { root: '/' },
    middlewares: { use: (handler: MiddlewareHandler) => handlers.push(handler) },
  }
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() }
  const state: PluginState = {
    routes: [],
    serverRoutes: [],
    swRoutes: [],
    disabledRoutes: [],
    ignoredRoutes: [],
    configFiles: [],
    disabledConfigFiles: [],
    app: null,
    lastSignature: null,
    lastDiagnosticsSignature: null,
  }
  const options = {
    state,
    root: '/',
    base: '/base/',
    logger,
    playgroundConfig: { enabled: false, path: '/__mokup', build: false },
    playgroundMiddleware: ((_req, _res, next) => next()) as MiddlewareHandler,
    swConfig: resolveSwConfig([{ dir: 'mock', mode: 'sw' }], logger),
    hasSwRoutes: () => true,
    enableViteMiddleware: false,
    refreshRoutes: async () => {},
    resolveAllDirs: () => [],
    watchEnabled: false,
  }
  await configureDevServer({ ...options, server: server as unknown as ViteDevServer })
  return handlers.at(-1)!
}

const factories = [
  { name: 'Vite dev', create: viteMiddleware },
  {
    name: 'Webpack',
    create: async () => {
      const snapshot: WebpackBuildSnapshot = {
        root: '/',
        base: '/base/',
        bundles: { swLifecycleBundle: null, swBundle: 'self.skipWaiting()' },
        state: {
          routes: [],
          serverRoutes: [],
          swRoutes: [{ file: 'test.get.json', method: 'GET', template: '/test', tokens: [], score: [], handler: 'ok' }],
          disabledRoutes: [],
          ignoredRoutes: [],
          configFiles: [],
          disabledConfigFiles: [],
          app: null,
          lastDiagnosticsSignature: null,
        },
      }
      const session = createWebpackBuildSession({ build: async () => snapshot, onRefresh: vi.fn(), onError: vi.fn() })
      await session.ensureBuilt()
      return createSwMiddleware({ swConfig: { path: '/mokup-sw.js' }, getSession: () => session, getBase: () => '/base/' })
    },
  },
]

async function request(handler: MiddlewareHandler, url: string) {
  const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() }
  const next = vi.fn()
  await handler({ url } as IncomingMessage, res as unknown as ServerResponse, next)
  return { res, next }
}

describe.each(factories)('$name service worker request boundary', ({ create }) => {
  it('returns a readable 400 for an invalid absolute request target', async () => {
    const handler = await create()
    const { res, next } = await request(handler, 'http://[')
    expect(res.statusCode).toBe(400)
    expect(res.end).toHaveBeenCalledWith('Invalid request URL.')
    expect(next).not.toHaveBeenCalled()
    expect((await request(handler, '/base/mokup-sw.js')).res.statusCode).toBe(200)
  })

  it.each(['//[', '//ignored/base/mokup-sw.js', '/ordinary'])('passes through the literal origin-form path %s', async (url) => {
    const { res, next } = await request(await create(), url)
    expect(next).toHaveBeenCalledExactlyOnceWith()
    expect(res.end).not.toHaveBeenCalled()
  })

  it.each(['/base/mokup-sw.js?version=1', 'http://localhost/base/mokup-sw.js'])('serves the worker for %s', async (url) => {
    const { res, next } = await request(await create(), url)
    expect(res.statusCode).toBe(200)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/javascript; charset=utf-8')
    expect(res.end).toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })
})
