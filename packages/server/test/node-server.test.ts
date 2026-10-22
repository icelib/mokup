import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAdaptorServer } from '@hono/node-server'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createFetchServer } from '../src/fetch-server'

function listenServer(server: ReturnType<typeof createAdaptorServer>) {
  return new Promise<{ host: string, port: number } | null>((resolve, reject) => {
    let onError: (error: Error) => void
    const onListening = () => {
      server.off('error', onError)
      const address = server.address()
      const host = typeof address === 'string' ? '127.0.0.1' : address?.address ?? '127.0.0.1'
      const port = typeof address === 'string' ? 0 : address?.port ?? 0
      resolve({ host, port })
    }
    onError = (error: Error) => {
      server.off('listening', onListening)
      if ('code' in error && error.code === 'EPERM') {
        resolve(null)
        return
      }
      reject(error)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })
}

function closeServer(server: ReturnType<typeof createAdaptorServer>) {
  return new Promise<void>((resolve, reject) => {
    try {
      server.close((error?: Error) => {
        if (error) {
          if (error.message === 'Server is not running.') {
            resolve()
            return
          }
          reject(error)
          return
        }
        resolve()
      })
    }
    catch (error) {
      if (error instanceof Error && error.message === 'Server is not running.') {
        resolve()
        return
      }
      reject(error)
    }
  })
}

const socketReaders = new WeakMap<WebSocket, { messages: unknown[], waiters: Array<{ resolve: (value: unknown) => void, reject: (error: unknown) => void }> }>()

function readWebSocketMessage(socket: WebSocket) {
  let reader = socketReaders.get(socket)
  if (!reader) {
    reader = { messages: [], waiters: [] }
    socketReaders.set(socket, reader)
    socket.on('message', (data) => {
      const value = JSON.parse(data.toString())
      const waiter = reader!.waiters.shift()
      if (waiter) {
        waiter.resolve(value)
      }
      else {
        reader!.messages.push(value)
      }
    })
    socket.on('error', (error) => {
      for (const waiter of reader!.waiters.splice(0)) {
        waiter.reject(error)
      }
    })
  }
  if (reader.messages.length) {
    return Promise.resolve(reader.messages.shift())
  }
  return new Promise<unknown>((resolve, reject) => {
    reader!.waiters.push({ resolve, reject })
  })
}

describe('node server', () => {
  it.each(['/__mokup', '/'])('serves playground metrics over websocket at %s', async (playgroundPath) => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-node-ws-'))
    const mockDir = join(root, 'mock')
    await mkdir(mockDir, { recursive: true })
    await writeFile(join(mockDir, 'ping.get.json'), '{"ok":true}', 'utf8')

    const fetchServer = await createFetchServer({
      entries: { dir: mockDir, log: false, watch: false },
      playground: { enabled: true, path: playgroundPath },
    })
    expect(fetchServer.websocket).toBeDefined()
    const nodeServer = createAdaptorServer({
      fetch: fetchServer.fetch,
      ...(fetchServer.websocket ? { websocket: fetchServer.websocket } : {}),
    })
    let socket: WebSocket | undefined

    try {
      const listening = await listenServer(nodeServer)
      if (!listening) {
        return
      }
      const { host, port } = listening
      const routePrefix = playgroundPath === '/' ? '' : playgroundPath
      socket = new WebSocket(`ws://${host}:${port}${routePrefix}/ws`)

      await expect(readWebSocketMessage(socket)).resolves.toMatchObject({
        type: 'snapshot',
        total: 0,
        perRoute: {},
        diagnostics: { timeline: [], totals: { started: 0, completed: 0 } },
      })

      const diagnostics: Array<{ entry: { type: string } }> = []
      const increment = (async () => {
        while (true) {
          const message = await readWebSocketMessage(socket)
          if (message && typeof message === 'object' && 'type' in message && message.type === 'diagnostic' && 'entry' in message) {
            diagnostics.push(message as { entry: { type: string } })
          }
          if (message.type === 'increment') {
            return message
          }
        }
      })()
      const response = await fetch(`http://${host}:${port}/ping`)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true })
      await expect(increment).resolves.toEqual({
        type: 'increment',
        routeKey: 'GET /ping',
        total: 1,
      })
      expect(diagnostics.some(message => message.entry.type === 'response:mocked')).toBe(true)
    }
    finally {
      socket?.terminate()
      await closeServer(nodeServer)
      await fetchServer.close?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['/__mokup', '/'])('serves mock routes and playground routes at %s', async (playgroundPath) => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-node-'))
    const mockDir = join(root, 'mock')
    await mkdir(mockDir, { recursive: true })
    await writeFile(
      join(mockDir, 'users.get.json'),
      JSON.stringify({ id: 1 }, null, 2),
      'utf8',
    )

    const fetchServer = await createFetchServer({
      entries: {
        dir: mockDir,
        log: false,
        watch: false,
      },
      playground: { path: playgroundPath },
    })
    const nodeServer = createAdaptorServer({ fetch: fetchServer.fetch })

    try {
      const listening = await listenServer(nodeServer)
      if (!listening) {
        return
      }
      const { host, port } = listening
      const base = `http://${host}:${port}`

      const response = await fetch(`${base}/users`)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ id: 1 })

      const routePrefix = playgroundPath === '/' ? '' : playgroundPath
      const routesResponse = await fetch(`${base}${routePrefix}/routes`)
      expect(routesResponse.status).toBe(200)
      const payload = await routesResponse.json()
      expect(payload.count).toBe(1)
      expect(payload.routes[0]?.url).toBe('/users')
    }
    finally {
      await closeServer(nodeServer)
      if (fetchServer.close) {
        await fetchServer.close()
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  it('supports multiple dir entries with prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-node-'))
    const mockDir = join(root, 'mock')
    const extraDir = join(root, 'fixtures')
    await mkdir(mockDir, { recursive: true })
    await mkdir(extraDir, { recursive: true })
    await writeFile(
      join(mockDir, 'users.get.json'),
      JSON.stringify({ id: 2 }, null, 2),
      'utf8',
    )
    await writeFile(
      join(extraDir, 'teams.get.json'),
      JSON.stringify({ id: 3 }, null, 2),
      'utf8',
    )

    const fetchServer = await createFetchServer({
      entries: [
        { dir: mockDir, watch: false, log: false },
        { dir: extraDir, prefix: '/api', watch: false, log: false },
      ],
    })
    const nodeServer = createAdaptorServer({ fetch: fetchServer.fetch })

    try {
      const listening = await listenServer(nodeServer)
      if (!listening) {
        return
      }
      const { host, port } = listening
      const response = await fetch(`http://${host}:${port}/users`)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ id: 2 })

      const prefixed = await fetch(`http://${host}:${port}/api/teams`)
      expect(prefixed.status).toBe(200)
      await expect(prefixed.json()).resolves.toEqual({ id: 3 })
    }
    finally {
      await closeServer(nodeServer)
      if (fetchServer.close) {
        await fetchServer.close()
      }
    }
  })
})
