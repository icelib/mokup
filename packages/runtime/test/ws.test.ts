import type { MockWebSocketConnection } from '../src/ws'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { createGraphQLWebSocket } from '../src/graphql'
import { createMockSession } from '../src/http'
import { setupWebSocket, ws } from '../src/ws'

function event<K extends keyof WebSocketEventMap>(socket: WebSocket, type: K): Promise<WebSocketEventMap[K]> {
  return new Promise((resolve, reject) => {
    let listener: (value: WebSocketEventMap[K]) => void
    const timeout = setTimeout(() => {
      socket.removeEventListener(type, listener)
      reject(new Error(`Timed out waiting for WebSocket ${type}.`))
    }, 2000)
    listener = (value: WebSocketEventMap[K]) => {
      clearTimeout(timeout)
      resolve(value)
    }
    socket.addEventListener(type, listener, { once: true })
  })
}

async function createEchoServer() {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  server.on('connection', (socket) => {
    socket.on('message', (data, binary) => socket.send(data, { binary }))
  })
  await once(server, 'listening')
  const address = server.address()
  if (typeof address === 'string' || address === null) {
    throw new Error('Expected a TCP server address.')
  }
  return {
    url: `ws://127.0.0.1:${address.port}/echo`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}

describe('WebSocket mocks', () => {
  it('intercepts the real global constructor and supports client messages, binary data, and close', async () => {
    const original = globalThis.WebSocket
    const link = ws.link('wss://example.test/chat')
    let connection: MockWebSocketConnection | undefined
    link.addEventListener('connection', (value) => {
      connection = value
      value.client.addEventListener('message', message => value.client.send(message.data))
    })
    const controller = setupWebSocket(link)
    const messages: Array<{ direction: string | undefined, data: unknown }> = []
    controller.events.on('protocol:message', (event) => {
      messages.push({ direction: event.direction, data: event.data })
    })
    controller.start()
    try {
      expect(globalThis.WebSocket).not.toBe(original)
      const socket = new WebSocket('wss://example.test/chat', ['chat-v1'])
      socket.binaryType = 'arraybuffer'
      await event(socket, 'open')
      expect(connection?.info.protocols).toEqual(['chat-v1'])
      expect(link.clients.size).toBe(1)
      const text = event(socket, 'message')
      socket.send('hello')
      expect((await text).data).toBe('hello')
      expect(messages[0]).toEqual({ direction: 'inbound', data: 'hello' })
      const binary = event(socket, 'message')
      socket.send(new Uint8Array([1, 2, 3]))
      expect(new Uint8Array((await binary).data as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]))
      expect(messages).toHaveLength(2)
      expect(messages[1]?.direction).toBe('inbound')
      const closed = event(socket, 'close')
      connection?.client.close(4001, 'done')
      expect(await closed).toMatchObject({ code: 4001, reason: 'done' })
      await Promise.resolve()
      expect(connection?.signal.aborted).toBe(true)
      expect(link.clients.size).toBe(0)
    }
    finally {
      await controller.stop()
    }
    expect(globalThis.WebSocket).toBe(original)
  })

  it('selects the first matching link and broadcasts only to its current clients', async () => {
    const specific = ws.link('/chat')
    const fallback = ws.link(/example\.test/g)
    const ignored = vi.fn()
    fallback.addEventListener('connection', ignored)
    const controller = setupWebSocket(specific, fallback)
    controller.start()
    try {
      const one = new WebSocket('wss://example.test/chat')
      const two = new WebSocket('wss://example.test/chat')
      const three = new WebSocket('wss://example.test/other')
      await Promise.all([event(one, 'open'), event(two, 'open'), event(three, 'open')])
      expect(specific.clients.size).toBe(2)
      expect(fallback.clients.size).toBe(1)
      expect(ignored).toHaveBeenCalledOnce()
      const first = event(one, 'message')
      const second = event(two, 'message')
      specific.broadcast('everyone')
      expect((await first).data).toBe('everyone')
      expect((await second).data).toBe('everyone')
      const recipients = [...specific.clients]
      const onlySecond = event(two, 'message')
      const oneMessages = vi.fn()
      one.addEventListener('message', oneMessages)
      specific.broadcast('except first', { except: [recipients[0]!] })
      expect((await onlySecond).data).toBe('except first')
      expect(oneMessages).not.toHaveBeenCalled()
      const snapshot = specific.clients as Set<unknown>
      snapshot.clear()
      expect(specific.clients.size).toBe(2)
    }
    finally {
      await controller.stop()
    }
    expect(specific.clients.size).toBe(0)
    expect(fallback.clients.size).toBe(0)
  })

  it('connects and sends to a real upstream, and can transform its messages', async () => {
    const upstream = await createEchoServer()
    const link = ws.link(upstream.url)
    link.addEventListener('connection', ({ client, server }) => {
      server.connect()
      client.addEventListener('message', (message) => {
        message.preventDefault()
        server.send(`sent:${String(message.data)}`)
      })
      server.addEventListener('message', (message) => {
        message.preventDefault()
        client.send(`received:${String(message.data)}`)
      })
    })
    const controller = setupWebSocket(link)
    controller.start()
    try {
      const socket = new WebSocket(upstream.url)
      await event(socket, 'open')
      const response = event(socket, 'message')
      socket.send('ping')
      expect((await response).data).toBe('received:sent:ping')
    }
    finally {
      await controller.stop()
      await upstream.close()
    }
  })

  it.each(['bypass', 'warn'] as const)('forwards unmatched connections to a real server under %s', async (policy) => {
    const upstream = await createEchoServer()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const controller = setupWebSocket(ws.link('/different'))
    controller.start({ onUnhandledConnection: policy })
    try {
      const socket = new WebSocket(upstream.url)
      await event(socket, 'open')
      const response = event(socket, 'message')
      socket.send('passthrough')
      expect((await response).data).toBe('passthrough')
      expect(warn).toHaveBeenCalledTimes(policy === 'warn' ? 1 : 0)
    }
    finally {
      await controller.stop()
      await upstream.close()
      warn.mockRestore()
    }
  })

  it('supports an unhandled callback before the default bypass and exposes connection context', async () => {
    const upstream = await createEchoServer()
    const callback = vi.fn(async (request, context) => {
      expect(request).toMatchObject({ method: 'CONNECT', url: upstream.url, protocol: 'websocket' })
      expect(context.signal).toBe(context.connection.signal)
      context.connection.server.connect()
    })
    const controller = setupWebSocket(ws.link('/different'))
    controller.start({ onUnhandled: callback })
    try {
      const socket = new WebSocket(upstream.url)
      await event(socket, 'open')
      const response = event(socket, 'message')
      socket.send('callback-bypass')
      expect((await response).data).toBe('callback-bypass')
      expect(callback).toHaveBeenCalledOnce()
    }
    finally {
      await controller.stop()
      await upstream.close()
    }
  })

  it('reports callback failures through protocol:error and closes the unhandled connection', async () => {
    const events: string[] = []
    const failure = new Error('reject this connection')
    const controller = setupWebSocket()
    controller.events.on('protocol:unhandled', () => events.push('unhandled'))
    controller.events.on('protocol:error', (event) => {
      events.push('error')
      expect(event.error).toBe(failure)
    })
    controller.events.on('protocol:end', () => events.push('end'))
    controller.start({
      onUnhandled: () => {
        throw failure
      },
    })
    try {
      const socket = new WebSocket('wss://example.test/unhandled-callback-error')
      expect(await event(socket, 'close')).toMatchObject({ code: 1000 })
      await Promise.resolve()
      expect(events).toEqual(['unhandled', 'error', 'end'])
    }
    finally {
      await controller.stop()
    }
  })

  it('cancels a pending unhandled callback when the controller stops', async () => {
    let resolveEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      resolveEntered = resolve
    })
    const controller = setupWebSocket()
    const errors: unknown[] = []
    controller.events.on('protocol:error', event => errors.push(event.error))
    controller.start({
      onUnhandled: async (_event, context) => {
        resolveEntered()
        await new Promise<void>((done) => {
          context.signal.addEventListener('abort', () => done(), { once: true })
        })
      },
    })
    const socket = new WebSocket('wss://example.test/pending-policy')
    await entered
    await controller.stop()
    expect(socket.readyState).toBe(WebSocket.CLOSED)
    expect(errors).toEqual([])
  })

  it('does not reconnect an unhandled socket closed by its callback', async () => {
    const upstream = await createEchoServer()
    const connect = vi.fn()
    const controller = setupWebSocket()
    controller.start({
      onUnhandled: (_event, context) => {
        connect()
        context.connection.client.close(1000, 'policy closed')
      },
    })
    try {
      const socket = new WebSocket(upstream.url)
      expect(await event(socket, 'close')).toMatchObject({ code: 1000, reason: 'policy closed' })
      expect(connect).toHaveBeenCalledOnce()
    }
    finally {
      await controller.stop()
      await upstream.close()
    }
  })

  it('rejects unmatched connections with a policy closure and never opens a socket', async () => {
    const controller = setupWebSocket()
    controller.start({ onUnhandledConnection: 'error' })
    try {
      const socket = new WebSocket('wss://example.test/unhandled')
      const opened = vi.fn()
      socket.addEventListener('open', opened)
      expect(await event(socket, 'close')).toMatchObject({ code: 1008 })
      expect(opened).not.toHaveBeenCalled()
    }
    finally {
      await controller.stop()
    }
  })

  it('emits shared protocol lifecycle events and can forward them to an HTTP session bus', async () => {
    const session = createMockSession()
    const events: string[] = []
    for (const type of ['protocol:start', 'protocol:match', 'protocol:end'] as const) {
      session.events.on(type, (event) => {
        events.push(`${type}:${event.protocol}`)
      })
    }
    const controller = setupWebSocket(ws.link('/events'))
    controller.start({ events: session.events })
    const socket = new WebSocket('wss://example.test/events')
    await event(socket, 'open')
    socket.close()
    await event(socket, 'close')
    await Promise.resolve()
    expect(events).toEqual(['protocol:start:websocket', 'protocol:match:websocket', 'protocol:end:websocket'])
    await controller.stop()
    await session.dispose()
  })

  it('runs GraphQL subscriptions through the shared protocol lifecycle', async () => {
    const session = createMockSession()
    const lifecycle: Array<{ type: string, operation?: string, direction?: string }> = []
    for (const type of ['protocol:start', 'protocol:match', 'protocol:message', 'protocol:end'] as const) {
      session.events.on(type, (value) => {
        lifecycle.push({ type, operation: value.operation, direction: 'direction' in value ? value.direction : undefined })
      })
    }
    const link = createGraphQLWebSocket('/graphql', {
      async* Updates() {
        yield { data: { update: 1 } }
      },
    }, { events: session.events })
    const controller = setupWebSocket(link)
    controller.start()
    try {
      const socket = new WebSocket('wss://example.test/graphql')
      await event(socket, 'open')

      const ack = event(socket, 'message')
      socket.send(JSON.stringify({ type: 'connection_init' }))
      expect(JSON.parse(String((await ack).data))).toEqual({ type: 'connection_ack' })

      const first = event(socket, 'message')
      socket.send(JSON.stringify({
        id: 'subscription-1',
        type: 'subscribe',
        payload: { query: 'subscription Updates { update }' },
      }))
      expect(JSON.parse(String((await first).data))).toEqual({
        id: 'subscription-1',
        type: 'next',
        payload: { data: { update: 1 } },
      })

      const complete = event(socket, 'message')
      expect(JSON.parse(String((await complete).data))).toEqual({ id: 'subscription-1', type: 'complete' })
      socket.close()
      await event(socket, 'close')
      await Promise.resolve()
    }
    finally {
      await controller.stop()
      await session.dispose()
    }
    expect(lifecycle.map(({ type, operation, direction }) => [type, operation, direction])).toEqual([
      ['protocol:start', 'subscription-1', undefined],
      ['protocol:message', 'subscription-1', 'inbound'],
      ['protocol:match', 'Updates', undefined],
      ['protocol:message', 'Updates', 'outbound'],
      ['protocol:message', 'Updates', 'outbound'],
      ['protocol:end', 'Updates', undefined],
    ])
  })

  it('stops queued messages, aborts pending listeners, and resets client state on restart', async () => {
    const original = globalThis.WebSocket
    const link = ws.link('*')
    const received = vi.fn()
    const active: MockWebSocketConnection[] = []
    link.addEventListener('connection', (connection) => {
      active.push(connection)
      connection.client.addEventListener('message', received)
    })
    const controller = setupWebSocket(link)
    controller.start()
    const first = new WebSocket('wss://example.test/chat')
    await event(first, 'open')
    first.send('queued')
    await controller.stop()
    expect(received).not.toHaveBeenCalled()
    expect(active[0]?.signal.aborted).toBe(true)
    expect(first.readyState).toBe(WebSocket.CLOSED)
    expect(link.clients.size).toBe(0)
    expect(() => active[0]?.server.connect()).toThrow()
    expect(globalThis.WebSocket).toBe(original)

    controller.start()
    try {
      const second = new WebSocket('wss://example.test/chat')
      await event(second, 'open')
      expect(link.clients.size).toBe(1)
      expect(active[1]?.signal.aborted).toBe(false)
      expect(active[0]?.client.id).not.toBe(active[1]?.client.id)
    }
    finally {
      await controller.stop()
    }

    const pending = ws.link('*')
    let entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    pending.addEventListener('connection', async () => {
      entered()
      await new Promise(() => {})
    })
    const pendingController = setupWebSocket(pending)
    pendingController.start()
    const pendingSocket = new WebSocket('wss://example.test/pending')
    await ready
    await pendingController.stop()
    expect(pendingSocket.readyState).toBe(WebSocket.CLOSED)
    expect(pending.clients.size).toBe(0)
    expect(globalThis.WebSocket).toBe(original)
  })

  it('prevents concurrent global controllers without damaging the active one', async () => {
    const link = ws.link('*')
    const one = setupWebSocket(link)
    const two = setupWebSocket(link)
    one.start()
    expect(() => two.start()).toThrow('already active')
    await two.stop()
    try {
      const socket = new WebSocket('wss://example.test/chat')
      await event(socket, 'open')
      expect(link.clients.size).toBe(1)
    }
    finally {
      await one.stop()
    }
    two.start()
    try {
      expect(link.clients.size).toBe(0)
    }
    finally {
      await two.stop()
    }
  })
})
