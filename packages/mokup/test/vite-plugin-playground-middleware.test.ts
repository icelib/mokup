import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMokupPlugin } from '../src/vite/plugin'

const serverHooks = vi.hoisted(() => ({
  configureDevServer: vi.fn(),
  configurePreviewServer: vi.fn(),
}))

vi.mock('../src/vite/plugin/server-hooks', () => serverHooks)

describe('vite plugin playground middleware', () => {
  it('serves playground index and uses getters', async () => {
    const plugin = createMokupPlugin({
      entries: { dir: '/root/mock', prefix: '/api' },
      playground: true,
    })

    plugin.configResolved?.({
      root: '/root',
      base: '/',
      command: 'serve',
      build: { outDir: 'dist', assetsDir: 'assets', ssr: false },
    } as any)

    const server = {
      config: { root: '/root', base: '/' },
      ws: {},
    }
    await plugin.configureServer?.(server as any)

    const params = serverHooks.configureDevServer.mock.calls[0]?.[0]
    const playgroundMiddleware = params.playgroundMiddleware as (
      req: IncomingMessage,
      res: ServerResponse,
      next: (err?: unknown) => void,
    ) => Promise<void>

    const state = {
      body: '',
      statusCode: 0,
    }
    const res = {
      setHeader: vi.fn(),
      end: (chunk?: string | Uint8Array) => {
        state.body = typeof chunk === 'string' ? chunk : ''
      },
      get statusCode() {
        return state.statusCode
      },
      set statusCode(value: number) {
        state.statusCode = value
      },
    } as unknown as ServerResponse

    let nextCalled = false
    await playgroundMiddleware(
      { url: '/__mokup/routes' } as IncomingMessage,
      res,
      () => {
        nextCalled = true
      },
    )

    expect(nextCalled).toBe(false)
    expect(state.body).toContain('routes')

    state.body = ''
    nextCalled = false
    await playgroundMiddleware(
      { url: '/__mokup/index.html' } as IncomingMessage,
      res,
      () => {
        nextCalled = true
      },
    )

    expect(nextCalled).toBe(false)
    expect(state.body).toContain('mokup-playground')
  })

  it('registers an existing preview worker with empty source routes and checks its presence on each HTML request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-preview-playground-sw-'))
    try {
      const workerDir = join(root, 'dist', 'nested')
      const workerFile = join(workerDir, 'mokup-sw.js')
      await mkdir(workerDir, { recursive: true })
      await writeFile(workerFile, '// Owned built worker fixture')
      const plugin = createMokupPlugin({
        entries: {
          dir: 'mock',
          mode: 'sw',
          sw: { path: '/nested/mokup-sw.js', fallback: false },
        },
        playground: { build: false },
      })
      const config = {
        root,
        base: '/workspace/',
        command: 'serve',
        build: { outDir: 'dist', assetsDir: 'assets', ssr: false },
      }
      plugin.configResolved?.(config as any)
      await plugin.configurePreviewServer?.({ config } as any)
      const params = serverHooks.configurePreviewServer.mock.calls.at(-1)?.[0]
      const playgroundMiddleware = params.playgroundMiddleware as (
        req: IncomingMessage,
        res: ServerResponse,
        next: (err?: unknown) => void,
      ) => Promise<void>

      async function request(url: string) {
        const state = { body: '', statusCode: 0 }
        const res = {
          setHeader: vi.fn(),
          end: (chunk?: string | Uint8Array) => {
            state.body = typeof chunk === 'string' ? chunk : ''
          },
          get statusCode() {
            return state.statusCode
          },
          set statusCode(value: number) {
            state.statusCode = value
          },
        } as unknown as ServerResponse
        const next = vi.fn()
        await playgroundMiddleware({ url } as IncomingMessage, res, next)
        expect(next).not.toHaveBeenCalled()
        expect(state.statusCode).toBe(200)
        return state.body
      }

      expect(JSON.parse(await request('/workspace/__mokup/routes'))).toMatchObject({ count: 0, routes: [] })
      const html = await request('/workspace/__mokup/')
      expect(html).toContain('mokup-playground-sw')
      expect(html).toContain('navigator.serviceWorker.register')
      expect(html).toContain('/workspace/nested/mokup-sw.js')
      expect(html).not.toContain('/@id/')
      expect(html).not.toContain('/@vite/client')
      expect(html).not.toContain('mokup-playground-hmr')

      await rm(workerFile)
      const withoutWorker = await request('/workspace/__mokup/')
      expect(withoutWorker).not.toContain('mokup-playground-sw')
      expect(withoutWorker).not.toContain('navigator.serviceWorker.register')
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
