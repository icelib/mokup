import type { ResolvedRoute } from '../src/dev/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHonoApp } from '../src/dev/hono'
import { createFetchServer } from '../src/fetch-server'

const mocks = vi.hoisted(() => ({
  scanRoutes: vi.fn<typeof import('../src/dev/scanner').scanRoutes>(),
  onChange: undefined as (() => void) | undefined,
  closeWatcher: vi.fn(async () => {}),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() },
}))

vi.mock('../src/dev/hono', { spy: true })
vi.mock('../src/dev/scanner', () => ({ scanRoutes: mocks.scanRoutes }))
vi.mock('../src/dev/logger', () => ({ createLogger: () => mocks.logger }))
vi.mock('../src/fetch-server/watcher', () => ({
  createWatcher: async ({ onChange }: { onChange: () => void }) => {
    mocks.onChange = onChange
    return { close: mocks.closeWatcher }
  },
}))
vi.mock('../src/fetch-server/playground-ws', () => ({
  createPlaygroundWs: () => ({
    handleRouteResponse: vi.fn(),
    setupPlaygroundWebSocket: vi.fn(),
    getWsHandler: () => undefined,
    getWebSocketOptions: () => undefined,
  }),
}))

function route(version: string): ResolvedRoute {
  return {
    method: 'GET',
    file: `/mock/${version}.get.ts`,
    template: '/version',
    tokens: [{ type: 'static', value: 'version' }],
    score: [4],
    handler: version,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.scanRoutes.mockReset()
  mocks.scanRoutes.mockResolvedValue([route('initial')])
})

describe('fetch server refresh snapshots', () => {
  it('keeps routes, playground metadata and responses together when app construction fails', async () => {
    const server = await createFetchServer({ entries: { dir: '/mock', log: false }, playground: true })
    const initialRoutes = server.getRoutes()
    try {
      mocks.scanRoutes.mockResolvedValueOnce([route('broken')])
      vi.mocked(createHonoApp).mockImplementationOnce(() => {
        throw new Error('App construction failed')
      })
      await expect(server.refresh()).resolves.toBeUndefined()
      expect(mocks.logger.error).toHaveBeenCalledWith('Failed to scan mock routes:', expect.any(Error))
      expect(server.getRoutes()).toBe(initialRoutes)
      expect(await (await server.fetch(new Request('http://localhost/version'))).text()).toBe('initial')
      const metadata = await server.fetch(new Request('http://localhost/__mokup/routes'))
      expect(await metadata.json()).toMatchObject({ routes: [{ url: '/version', file: expect.stringContaining('initial.get.ts') }] })

      mocks.scanRoutes.mockResolvedValueOnce([route('updated')])
      await server.refresh()
      expect(server.getRoutes()).not.toBe(initialRoutes)
      expect(await (await server.fetch(new Request('http://localhost/version'))).text()).toBe('updated')
    }
    finally {
      await server.close?.()
    }
  })

  it('propagates explicit diagnostic failures, logs background failures, and recovers', async () => {
    vi.useFakeTimers()
    const server = await createFetchServer({
      entries: { dir: '/mock', log: false, errorOn: ['invalid-route'] },
      playground: false,
    })
    try {
      const invalidScan: typeof import('../src/dev/scanner').scanRoutes = async (params) => {
        params.onIgnore?.({ file: '/mock/broken.get.ts', reason: 'invalid-route' })
        return []
      }
      mocks.scanRoutes.mockImplementationOnce(invalidScan)
      await expect(server.refresh()).rejects.toThrow('Mokup diagnostics error:')
      expect(await (await server.fetch(new Request('http://localhost/version'))).text()).toBe('initial')

      mocks.scanRoutes.mockImplementationOnce(invalidScan)
      mocks.onChange?.()
      await vi.advanceTimersByTimeAsync(80)
      expect(mocks.logger.error).toHaveBeenCalledTimes(2)
      expect(server.getRoutes()[0]?.file).toBe('/mock/initial.get.ts')

      mocks.scanRoutes.mockResolvedValueOnce([route('recovered')])
      await server.refresh()
      expect(await (await server.fetch(new Request('http://localhost/version'))).text()).toBe('recovered')
    }
    finally {
      await server.close?.()
      vi.useRealTimers()
    }
  })
})
