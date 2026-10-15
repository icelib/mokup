import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PreviewServer } from 'vite'
import type { MiddlewareHandler } from '../src/vite/plugin/middleware'
import type { PluginState } from '../src/vite/plugin/state'
import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import { createPlaygroundMiddleware } from '@mokup/core'
import { Hono } from '@mokup/shared/hono'
import { describe, expect, it, vi } from 'vitest'
import { configurePreviewServer } from '../src/vite/plugin/server-hooks'

async function createPreview(options: {
  path?: string
  base?: string
  build?: boolean
  enabled?: boolean
  ssr?: boolean
  enableViteMiddleware?: boolean
} = {}) {
  const base = options.base ?? '/workspace/'
  const stack: Array<{ route: string, handle: MiddlewareHandler }> = []
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() }
  const mock = vi.fn(() => 'Node mock sentinel')
  const app = new Hono()
  app.all('*', c => c.text(mock()))
  const state: PluginState = {
    routes: [{ file: '/fixture/mock/value.get.json', template: '/value', method: 'GET', tokens: [], score: [], handler: { value: 1 } }],
    serverRoutes: [],
    swRoutes: [],
    disabledRoutes: [],
    ignoredRoutes: [],
    configFiles: [],
    disabledConfigFiles: [],
    app,
    lastSignature: null,
    lastDiagnosticsSignature: null,
    swModuleVersion: 0,
  }
  const server = {
    config: { root: '/fixture', base, build: { ssr: options.ssr ?? false, outDir: 'missing-output' } },
    middlewares: {
      stack,
      use: (handle: MiddlewareHandler) => stack.push({ route: '', handle }),
    },
  } as unknown as PreviewServer
  const playgroundConfig = {
    path: options.path ?? '/__mokup',
    enabled: options.enabled ?? true,
    build: options.build ?? true,
  }
  const dynamic = vi.fn(createPlaygroundMiddleware({
    config: playgroundConfig,
    getRoutes: () => state.routes,
    getServer: () => server,
    logger,
    // These tests only request dynamic routes; no filesystem assets are read.
    resolvePlaygroundDist: () => '/fixture/unused-playground-assets',
  }))
  await configurePreviewServer({
    server,
    state,
    root: '/fixture',
    base,
    logger,
    playgroundConfig,
    playgroundMiddleware: dynamic,
    swConfig: null,
    enableViteMiddleware: options.enableViteMiddleware ?? true,
    refreshRoutes: async () => {},
    resolveAllDirs: () => [],
    watchEnabled: false,
  })
  const downstream = vi.fn<MiddlewareHandler>((_req, res) => res.end('Static middleware sentinel'))
  stack.push({ route: '', handle: downstream })

  return {
    dynamic,
    mock,
    downstream,
    async request(url: string) {
      const req = Object.assign(Readable.from([]), { url, method: 'GET', headers: {} }) as IncomingMessage
      const result = { status: 200, body: '', headers: {} as Record<string, string> }
      const res = {
        get statusCode() {
          return result.status
        },
        set statusCode(value: number) {
          result.status = value
        },
        writableEnded: false,
        headersSent: false,
        setHeader(name: string, value: string) {
          result.headers[name.toLowerCase()] = value
        },
        end(chunk?: string | Uint8Array) {
          result.body = typeof chunk === 'string' ? chunk : Buffer.from(chunk ?? []).toString()
          res.writableEnded = true
        },
      }
      try {
        for (const { handle } of stack) {
          const next = vi.fn()
          await handle(req, res as unknown as ServerResponse, next)
          if (!next.mock.calls.length) {
            break
          }
        }
        return result
      }
      finally {
        req.destroy()
      }
    },
  }
}

describe('static Playground preview ownership', () => {
  it.each(['/__mokup', '/workspace/__mokup', '/nested/../__mokup'])('redirects the canonical %s entrance with its query intact', async (path) => {
    const preview = await createPreview({ path })
    const response = await preview.request('/workspace/__mokup?filter=a%2Fb&tab=routes')

    expect(response).toEqual({
      status: 302,
      body: '',
      headers: { location: '/workspace/__mokup/?filter=a%2Fb&tab=routes' },
    })
    expect(preview.dynamic).not.toHaveBeenCalled()
    expect(preview.mock).not.toHaveBeenCalled()
    expect(preview.downstream).not.toHaveBeenCalled()
  })

  it.each(['/', '/index.html', '/routes', '/assets/playground.js', '/assets/missing.js'])('passes %s through a catch-all mock to static middleware', async (suffix) => {
    const preview = await createPreview()
    const url = `/workspace/__mokup${suffix}?version=built`
    const response = await preview.request(url)

    expect(response.body).toBe('Static middleware sentinel')
    expect(preview.downstream.mock.calls[0]?.[0].url).toBe(url)
    expect(preview.dynamic).not.toHaveBeenCalled()
    expect(preview.mock).not.toHaveBeenCalled()
  })

  it.each(['/workspace/__mokup-other/routes', '/__mokup/routes', '/workspace/api/value'])('preserves mock ownership of %s', async (url) => {
    const preview = await createPreview()

    expect((await preview.request(url)).body).toBe('Node mock sentinel')
    expect(preview.mock).toHaveBeenCalledOnce()
    expect(preview.dynamic).not.toHaveBeenCalled()
    expect(preview.downstream).not.toHaveBeenCalled()
  })

  it.each([false, true])('does not fall back to dynamic routes when output is missing (ssr=%s)', async (ssr) => {
    const preview = await createPreview({ ssr })

    expect((await preview.request('/workspace/__mokup/routes')).body).toBe('Static middleware sentinel')
    expect(preview.dynamic).not.toHaveBeenCalled()
    expect(preview.mock).not.toHaveBeenCalled()
  })

  it.each(['/', '/workspace', '/workspace/', '/nested/..'])('does not reserve the application root for rejected build path %s', async (path) => {
    const preview = await createPreview({ path })

    expect((await preview.request('/workspace')).body).toBe('Node mock sentinel')
    expect((await preview.request('/workspace/api/value')).body).toBe('Node mock sentinel')
    expect(preview.dynamic).not.toHaveBeenCalled()
    expect(preview.downstream).not.toHaveBeenCalled()
  })

  it('does not reserve disabled Playground paths', async () => {
    const preview = await createPreview({ enabled: false })

    expect((await preview.request('/workspace/__mokup/routes')).body).toBe('Node mock sentinel')
    expect(preview.downstream).not.toHaveBeenCalled()
  })

  it('supports static Playground preview without Node mock middleware', async () => {
    const preview = await createPreview({ enableViteMiddleware: false, base: '/' })

    expect((await preview.request('/__mokup?view=all')).headers.location).toBe('/__mokup/?view=all')
    expect((await preview.request('/__mokup/routes')).body).toBe('Static middleware sentinel')
    expect((await preview.request('/other')).body).toBe('Static middleware sentinel')
    expect(preview.dynamic).not.toHaveBeenCalled()
    expect(preview.mock).not.toHaveBeenCalled()
  })

  it('rejects malformed request URLs before dispatching them', async () => {
    const preview = await createPreview()

    expect(await preview.request('http://[invalid')).toMatchObject({ status: 400, body: 'Invalid request URL.' })
    expect(preview.dynamic).not.toHaveBeenCalled()
    expect(preview.mock).not.toHaveBeenCalled()
    expect(preview.downstream).not.toHaveBeenCalled()
  })
})

describe('dynamic Playground preview compatibility', () => {
  it.each(['/workspace/__mokup/routes', '/__mokup/routes'])('retains dynamic route lookup for %s when build is false', async (url) => {
    const preview = await createPreview({ build: false })
    const response = await preview.request(url)

    expect(JSON.parse(response.body)).toMatchObject({ count: 1, routes: [{ url: '/value' }] })
    expect(preview.dynamic).toHaveBeenCalledOnce()
    expect(preview.mock).not.toHaveBeenCalled()
    expect(preview.downstream).not.toHaveBeenCalled()
  })

  it('retains a dynamic root Playground when build is false', async () => {
    const preview = await createPreview({ build: false, path: '/' })

    expect(JSON.parse((await preview.request('/workspace/routes')).body)).toMatchObject({ count: 1 })
    expect(preview.mock).not.toHaveBeenCalled()
  })
})
