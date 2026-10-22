import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFetchServer } from '../src/fetch-server'

const wsMocks = vi.hoisted(() => ({
  server: null as unknown,
}))

vi.mock('@hono/node-server', () => ({
  upgradeWebSocket: () => () => new Response('ok'),
}))

vi.mock('ws', () => ({
  WebSocketServer: class MockWebSocketServer extends EventEmitter {
    options = { noServer: true }
    clients = new Set<{ terminate: () => void }>()
    close = vi.fn((callback: (error?: Error) => void) => {
      this.emit('close')
      callback()
    })

    constructor() {
      super()
      wsMocks.server = this
    }
  },
}))

describe('fetch server websocket integration', () => {
  it('exposes websocket options when available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-fetch-ws-'))
    const mockDir = join(root, 'mock')
    await mkdir(mockDir, { recursive: true })
    await writeFile(join(mockDir, 'ping.get.json'), '{"ok":true}', 'utf8')

    const server = await createFetchServer({
      entries: { dir: mockDir, log: false, watch: false },
      playground: { enabled: true },
    })

    expect(server.websocket?.server).toBe(wsMocks.server)
    await server.dispose()
    expect((wsMocks.server as { close: unknown }).close).toHaveBeenCalledOnce()
    await rm(root, { recursive: true, force: true })
  })

  it('releases the diagnostic server when initial scanning fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-fetch-ws-failed-'))
    try {
      await writeFile(join(root, 'broken.get.ts'), 'export default { handler: undefined }')
      await expect(createFetchServer({
        entries: { dir: root, watch: false, log: false, errorOn: ['missing-handler'] },
      })).rejects.toThrow('Mokup diagnostics error')
      expect((wsMocks.server as { close: unknown }).close).toHaveBeenCalledOnce()
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
