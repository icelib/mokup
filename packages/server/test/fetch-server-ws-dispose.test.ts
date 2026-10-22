import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createFetchServer } from '../src/fetch-server'

describe('file server Playground connection ownership', () => {
  it('closes active diagnostic WebSockets when the file server is disposed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-ws-dispose-'))
    const server = await createFetchServer({ entries: { dir: root, watch: false, log: false } })
    const httpServer = serve({ fetch: server.fetch, hostname: '127.0.0.1', port: 0, websocket: server.websocket! })
    if (!httpServer.listening) {
      await once(httpServer, 'listening')
    }
    const client = new WebSocket(`ws://127.0.0.1:${(httpServer.address() as AddressInfo).port}/__mokup/ws`)
    try {
      await once(client, 'open')
      const closed = once(client, 'close')
      await server.dispose()
      await closed
      expect(client.readyState).toBe(WebSocket.CLOSED)
      expect((server.websocket!.server as unknown as { clients: Set<unknown> }).clients.size).toBe(0)
    }
    finally {
      client.terminate()
      await server.dispose()
      await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()))
      await rm(root, { recursive: true, force: true })
    }
  })
})
