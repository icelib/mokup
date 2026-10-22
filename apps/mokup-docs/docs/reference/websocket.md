# WebSocket mocks

`mokup/ws` mocks connections created with the global web-standard `WebSocket` constructor. It uses a separate controller from HTTP interception.

```ts
import { setupWebSocket, ws } from 'mokup/ws'

const chat = ws.link('wss://example.test/chat')
chat.addEventListener('connection', ({ client, signal }) => {
  client.addEventListener('message', (event) => {
    client.send(`echo:${String(event.data)}`)
  })
  signal.addEventListener('abort', () => {
    // Release timers or other resources created for this connection.
  }, { once: true })
})

const sockets = setupWebSocket(chat)
sockets.start({ onUnhandledConnection: 'error' })

// Run application code that creates WebSocket connections.
// Await stop() in test teardown or when leaving the application preview.
await sockets.stop()
```

`setupWebSocket` exposes the same event shape used by HTTP sessions. Pass an existing
session event bus to `start({ events })` to merge `protocol:start`, `protocol:match`,
`protocol:message`, `protocol:unhandled`, `protocol:end`, and `protocol:error` into one diagnostics stream:

```ts
const session = createMockSession()
const diagnostics = createDiagnosticsCollector(session)
const sockets = setupWebSocket(chat)
sockets.start({ events: session.events })
// diagnostics.snapshot().timeline now includes websocket connection metadata.
```

## Matching and clients

Links are tried in the order passed to `setupWebSocket`. The first matching link owns the connection, even when it has no connection listeners.

- An absolute `ws:` or `wss:` URL matches the complete normalized URL, including its query string.
- A string beginning with `/` matches the exact pathname and query across hosts.
- `'*'` matches every WebSocket URL.
- A regular expression matches the full URL. Its `lastIndex` does not carry over between connections.

`link.clients` returns a snapshot of its current clients. `link.broadcast(data)` sends text or binary data to each of them. Pass `{ except: [client] }` to exclude specific clients. This collection is local to the current JavaScript realm; it does not synchronize browser tabs or processes.

`client.send(data)` sends data to the application. `client.close(code?, reason?)` closes its connection. Client `message` listeners receive messages sent by the application, and client `close` listeners observe its closure. `addEventListener('connection', listener)` returns a function that removes that connection listener.

## Forwarding to an upstream server

Connections remain mocked until `server.connect()` opens the original destination. After connecting, application messages and upstream responses are forwarded automatically. Use `event.preventDefault()` to replace or suppress either direction.

```ts
chat.addEventListener('connection', ({ client, server }) => {
  server.connect()
  client.addEventListener('message', (event) => {
    event.preventDefault()
    server.send(`modified:${String(event.data)}`)
  })
  server.addEventListener('message', (event) => {
    event.preventDefault()
    client.send(`upstream:${String(event.data)}`)
  })
})
```

`server.send(data)` requires `server.connect()` first and queues data until the upstream opens. `server.close()` closes only the upstream connection. Server events include `open`, `message`, `error`, and `close`.

## GraphQL subscriptions

`createGraphQLWebSocket` from `mokup/graphql` builds a `ws.link` for the `graphql-transport-ws` protocol. It acknowledges `connection_init`, accepts named `subscribe` payloads, streams `next` values, and closes each operation with `complete`. The returned link is started with the same controller as other WebSocket mocks.

```ts
import { createGraphQLWebSocket } from 'mokup/graphql'
import { setupWebSocket } from 'mokup/ws'

const graphql = createGraphQLWebSocket('/graphql', {
  async* Count() {
    yield { count: 1 }
    yield { count: 2 }
  },
})
const controller = setupWebSocket(graphql)
controller.start({ onUnhandledConnection: 'error' })
```

Resolvers receive a standard Mokup request context with the parsed query, operation name, variables, request ID and an abortable request signal. Use `graphql.link('/graphql').subscription(...)` when the client uses the HTTP/SSE transport instead.

## Lifecycle and support

`start()` is idempotent. Only one Mokup WebSocket controller can be active in a JavaScript realm; starting another throws without replacing the current controller. HTTP controllers can run alongside it. `stop()` aborts connection signals, removes connection message listeners, initiates closure of owned mocked and forwarded sockets, empties client collections, and restores the original global constructor. Calling `start()` again creates fresh connections; link definitions and connection listeners remain reusable.

`onUnhandled` is independent of HTTP policies. Its default, `bypass`, connects to the original server; `warn` also logs a warning; `error` closes the connection with code `1008` before it opens. The callback form receives the shared protocol event and `{ signal, connection }`, then follows the normal bypass path unless it throws. `onUnhandledConnection` remains as a deprecated compatibility alias.

```ts
const controller = setupWebSocket(chat)
controller.start({
  onUnhandled(event, { connection, signal }) {
    console.warn(`No mock for ${event.url}`)
    // A callback can inspect or connect the original upstream itself.
    if (!signal.aborted) {
      connection.server.connect()
    }
  },
})
```

The interceptor controls the application's `open` event. Forwarded connections can appear open before the upstream handshake completes, and the mocked subprotocol is selected from the client's requested protocols. Do not use this controller to validate real handshake timing, negotiated subprotocols, TLS, compression, frame fragmentation, or server-side WebSocket upgrades.

Generic connections emit `protocol:message` for every wire payload with `direction: 'inbound'` (application to mock) or `direction: 'outbound'` (mock/upstream to application). GraphQL adds operation-scoped protocol events on top of these transport events.

Browsers with a patchable global WebSocket and Node.js versions with a global WebSocket can use this entry directly. On Node.js 20, provide a compatible implementation such as `undici` on `globalThis.WebSocket` before `start()`; otherwise `start()` throws with setup instructions. Imported constructors such as `import WebSocket from 'ws'` are not intercepted unless installed as the global constructor before application code runs. This API does not intercept sockets created before `start()` or in other realms.

Integration tests exercise mocked text/binary messages, forwarding to a real local WebSocket server, request and response rewriting, strict unhandled connections, priority, broadcasts, cancellation, stop, and restart using Node's global WebSocket. Browser conformance covers matched messages, broadcasts, unhandled error policy, lifecycle events, and teardown in Chrome, Firefox, and WebKit; handshake timing and negotiated subprotocol behavior remain outside that matrix.
