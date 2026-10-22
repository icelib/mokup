import type {
  WebSocketClientConnection,
  WebSocketConnectionData,
  WebSocketData,
  WebSocketServerConnection,
} from '@mswjs/interceptors/WebSocket'
import type { HttpEvents, ProtocolEvent } from './http/types'
import { WebSocketInterceptor } from '@mswjs/interceptors/WebSocket'
import { createHttpEvents } from './http/events'
import { withAbort } from './http/resources'

export type WebSocketMatcher = string | URL | RegExp
export type MockWebSocketClient = Pick<WebSocketClientConnection, 'id' | 'url' | 'send' | 'close' | 'addEventListener' | 'removeEventListener'>
export type MockWebSocketServer = Pick<WebSocketServerConnection, 'connect' | 'send' | 'close' | 'addEventListener' | 'removeEventListener'>
export type { WebSocketData } from '@mswjs/interceptors/WebSocket'

export interface MockWebSocketConnection {
  client: MockWebSocketClient
  server: MockWebSocketServer
  info: WebSocketConnectionData['info']
  /** Aborted when the client closes or its controller stops. */
  signal: AbortSignal
}

/** Context supplied to a WebSocket unhandled-connection callback. */
export interface WebSocketUnhandledContext {
  /** Aborted when the connection closes or the controller stops. */
  readonly signal: AbortSignal
  /** The connection that would otherwise be bypassed or rejected. */
  readonly connection: MockWebSocketConnection
}

/** Policy used when no `ws.link()` matches a connection. */
export type WebSocketUnhandledPolicy
  = | 'bypass'
    | 'warn'
    | 'error'
    | ((event: ProtocolEvent, context: WebSocketUnhandledContext) => void | Promise<void>)

export type WebSocketConnectionListener = (connection: MockWebSocketConnection) => void | Promise<void>

export interface WebSocketLink {
  readonly matcher: WebSocketMatcher
  /** Snapshot of connections currently owned by this link. */
  readonly clients: ReadonlySet<MockWebSocketClient>
  addEventListener: (type: 'connection', listener: WebSocketConnectionListener) => () => void
  removeEventListener: (type: 'connection', listener: WebSocketConnectionListener) => void
  broadcast: (data: WebSocketData, options?: { except?: Iterable<MockWebSocketClient> }) => void
}

interface LinkState {
  listeners: Set<WebSocketConnectionListener>
  clients: Set<MockWebSocketClient>
}

const states = new WeakMap<WebSocketLink, LinkState>()

function getState(link: WebSocketLink): LinkState {
  const state = states.get(link)
  if (!state) {
    throw new TypeError('Expected a WebSocket link created by ws.link().')
  }
  return state
}

function createLink(matcher: WebSocketMatcher): WebSocketLink {
  const state: LinkState = { listeners: new Set(), clients: new Set() }
  // Take a snapshot, so mutating the caller's URL/RegExp cannot change routing.
  const saved = matcher instanceof URL ? matcher.href : matcher instanceof RegExp ? new RegExp(matcher.source, matcher.flags) : matcher
  const link: WebSocketLink = Object.freeze({
    matcher: saved,
    get clients() {
      return new Set(state.clients)
    },
    addEventListener(_type: 'connection', listener: WebSocketConnectionListener) {
      state.listeners.add(listener)
      return () => state.listeners.delete(listener)
    },
    removeEventListener(_type: 'connection', listener: WebSocketConnectionListener) {
      state.listeners.delete(listener)
    },
    broadcast(data: WebSocketData, options: { except?: Iterable<MockWebSocketClient> } = {}) {
      const excluded = new Set(options.except)
      for (const client of state.clients) {
        if (!excluded.has(client)) {
          client.send(data)
        }
      }
    },
  })
  states.set(link, state)
  return link
}

/** Define a WebSocket endpoint; start interception with setupWebSocket(link).start(). */
export const ws = Object.freeze({ link: createLink })

function matches(matcher: WebSocketMatcher, url: URL) {
  if (matcher instanceof RegExp) {
    return new RegExp(matcher.source, matcher.flags).test(url.href)
  }
  const value = String(matcher)
  if (value === '*') {
    return true
  }
  if (value.startsWith('/')) {
    return `${url.pathname}${url.search}` === value
  }
  return new URL(value).href === url.href
}

export interface WebSocketStartOptions {
  /** WebSocket policies are independent of HTTP sessions and unhandled policies. */
  onUnhandled?: WebSocketUnhandledPolicy
  /** @deprecated Use `onUnhandled`; retained for compatibility with the initial WebSocket API. */
  onUnhandledConnection?: WebSocketUnhandledPolicy
  /** Optional shared HTTP event bus for cross-transport lifecycle diagnostics. */
  events?: Pick<HttpEvents, 'emit'>
}

export interface WebSocketController {
  readonly events: HttpEvents
  start: (options?: WebSocketStartOptions) => void
  /** Close owned sockets, abort connections and restore the global constructor. */
  stop: () => Promise<void>
}

let activeController: object | undefined

function ownConnection(data: WebSocketConnectionData, release: () => void) {
  const lifetime = new AbortController()
  const listeners: Array<() => void> = []
  let connected = false
  let disposed = false
  let onClose: () => void
  const assertActive = () => lifetime.signal.throwIfAborted()
  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    lifetime.abort(new DOMException('WebSocket mock connection closed.', 'AbortError'))
    data.client.removeEventListener('close', onClose)
    for (const remove of listeners.splice(0)) {
      remove()
    }
    try {
      if (connected) {
        data.server.close()
      }
    }
    finally {
      data.client.close(1000, 'Mock session stopped')
      release()
    }
  }
  const client: MockWebSocketClient = {
    id: data.client.id,
    url: data.client.url,
    send(value) {
      assertActive()
      data.client.send(value)
    },
    close: (code, reason) => data.client.close(code, reason),
    addEventListener(type, listener, options) {
      assertActive()
      data.client.addEventListener(type, listener, options)
      listeners.push(() => data.client.removeEventListener(type, listener, options))
    },
    removeEventListener: (type, listener, options) => data.client.removeEventListener(type, listener, options),
  }
  const server: MockWebSocketServer = {
    connect() {
      assertActive()
      if (connected) {
        throw new Error('The mock WebSocket is already connected to its upstream server.')
      }
      data.server.connect()
      connected = true
    },
    send(value) {
      assertActive()
      data.server.send(value)
    },
    close() {
      assertActive()
      data.server.close()
    },
    addEventListener(type, listener, options) {
      assertActive()
      data.server.addEventListener(type, listener, options)
      listeners.push(() => data.server.removeEventListener(type, listener, options))
    },
    removeEventListener: (type, listener, options) => data.server.removeEventListener(type, listener, options),
  }
  onClose = () => queueMicrotask(dispose)
  data.client.addEventListener('close', onClose, { once: true })
  return {
    connection: { client, server, info: data.info, signal: lifetime.signal },
    get connected() {
      return connected
    },
    dispose,
  }
}

/**
 * Intercept the global web-standard WebSocket constructor independently of HTTP.
 * Only one mokup WebSocket controller may run in a JavaScript realm at a time.
 */
export function setupWebSocket(...links: WebSocketLink[]): WebSocketController {
  links.forEach(getState)
  const identity = {}
  const emitter = createHttpEvents()
  let interceptor: WebSocketInterceptor | undefined
  let sink: Pick<HttpEvents, 'emit'> = emitter.events
  let sequence = 0
  const connections = new Set<ReturnType<typeof ownConnection>>()
  const publish = <T extends keyof import('./http/types').HttpEventMap>(type: T, event: import('./http/types').HttpEventMap[T]) => {
    emitter.emit(type, event)
    if (sink !== emitter.events) {
      sink.emit(type, event)
    }
  }
  return {
    events: emitter.events,
    start(options = {}) {
      if (interceptor) {
        return
      }
      if (activeController) {
        throw new Error('Another mokup WebSocket controller is already active. Stop it before starting another.')
      }
      if (typeof globalThis.WebSocket !== 'function') {
        throw new TypeError('WebSocket interception requires a global WebSocket constructor. On Node.js 20, install a web-standard implementation such as undici before start().')
      }
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')
      if (descriptor && !descriptor.configurable && !descriptor.writable) {
        throw new Error('The global WebSocket constructor cannot be patched.')
      }
      const policy = options.onUnhandled ?? options.onUnhandledConnection ?? 'bypass'
      sink = options.events ?? emitter.events
      const next = new WebSocketInterceptor()
      next.on('connection', async (data) => {
        if (interceptor !== next) {
          data.client.close(1000, 'Mock session stopped')
          return
        }
        const requestId = `${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}-ws-${++sequence}`
        const baseEvent: ProtocolEvent = {
          requestId,
          method: 'CONNECT',
          url: data.client.url.href,
          protocol: 'websocket',
          connectionId: String(data.client.id),
        }
        publish('protocol:start', baseEvent)
        const link = links.find(link => matches(link.matcher, data.client.url))
        const state = link ? getState(link) : undefined
        const owned = ownConnection(data, () => {
          connections.delete(owned)
          state?.clients.delete(owned.connection.client)
          publish('protocol:end', baseEvent)
        })
        connections.add(owned)
        // Observe both directions at the transport boundary so every WebSocket
        // connection has the same lifecycle diagnostics, including bypassed
        // connections. The protocol adapters (for example GraphQL) may emit
        // richer operation events separately; these generic events preserve the
        // actual wire payload for debugging and replay.
        owned.connection.client.addEventListener('message', (event) => {
          publish('protocol:message', { ...baseEvent, direction: 'inbound', data: event.data })
        })
        owned.connection.server.addEventListener('message', (event) => {
          publish('protocol:message', { ...baseEvent, direction: 'outbound', data: event.data })
        })
        if (!state) {
          publish('protocol:unhandled', { ...baseEvent, reason: 'No WebSocket link matched this URL.' })
          try {
            if (typeof policy === 'function') {
              // A policy can perform asynchronous inspection or connect the
              // socket to an upstream. Tie that work to the connection so a
              // stopped controller never leaves an unhandled callback alive.
              await withAbort(
                Promise.resolve().then(() => policy(baseEvent, { signal: owned.connection.signal, connection: owned.connection })),
                owned.connection.signal,
              )
            }
            else if (policy === 'error') {
              data.client.close(1008, `Unhandled WebSocket connection: ${data.client.url.pathname}`.slice(0, 120))
              return
            }
            else if (policy === 'warn') {
              // eslint-disable-next-line no-console -- Explicit warning policy is part of the controller API.
              console.warn(`[mokup] Unhandled WebSocket connection: ${data.client.url.href}`)
            }
          }
          catch (error) {
            // Closing a socket or stopping the controller aborts the callback
            // by design. It is a normal teardown path, not a protocol error.
            if (owned.connection.signal.aborted) {
              return
            }
            publish('protocol:error', { ...baseEvent, error })
            owned.dispose()
            return
          }
          // The close event is delivered asynchronously by the interceptor.
          // Give it one turn before deciding whether the default bypass should
          // connect the upstream socket.
          await Promise.resolve()
          if (owned.connection.signal.aborted) {
            return
          }
          if (!owned.connected) {
            owned.connection.server.connect()
          }
          return
        }
        state.clients.add(owned.connection.client)
        publish('protocol:match', { ...baseEvent, matcher: String(link?.matcher ?? '') })
        try {
          for (const listener of [...state.listeners]) {
            if (owned.connection.signal.aborted) {
              break
            }
            await withAbort(Promise.resolve().then(() => listener(owned.connection)), owned.connection.signal)
          }
        }
        catch (error) {
          if (owned.connection.signal.aborted) {
            return
          }
          publish('protocol:error', { ...baseEvent, error })
          owned.dispose()
          throw error
        }
      })
      try {
        next.apply()
        interceptor = next
        activeController = identity
      }
      catch (error) {
        next.dispose()
        throw error
      }
    },
    async stop() {
      const current = interceptor
      interceptor = undefined
      const failures: unknown[] = []
      try {
        for (const owned of [...connections]) {
          try {
            owned.dispose()
          }
          catch (error) {
            failures.push(error)
          }
        }
      }
      finally {
        current?.dispose()
        if (activeController === identity) {
          activeController = undefined
        }
      }
      // WebSocket close events are dispatched on the following microtask.
      await Promise.resolve()
      if (failures.length) {
        throw new AggregateError(failures, 'Failed to close mock WebSocket connections.')
      }
      sink = emitter.events
    },
  }
}
