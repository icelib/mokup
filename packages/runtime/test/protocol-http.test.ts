import type { HttpEvents, HttpHandler } from '../src/http'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { createGraphQLHandler, createGraphQLPersistedOperations, createGraphQLWebSocket, generateGraphQLSource, graphql } from '../src/graphql'
import { createMockSession, HttpResponse } from '../src/http'
import { eventStream, sse } from '../src/sse'
import { setupWebSocket } from '../src/ws'

function websocketMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for a GraphQL WebSocket message.')), 2000)
    socket.addEventListener('message', (event) => {
      clearTimeout(timer)
      resolve(String(event.data))
    }, { once: true })
  })
}

describe('GraphQL HTTP handlers', () => {
  it('selects operations and variables without consuming the original request', async () => {
    const session = createMockSession(graphql.link('/graphql').query('User', ({ variables }) => HttpResponse.json({ data: variables })))
    const request = new Request('https://example.com/graphql', { method: 'POST', body: JSON.stringify({ query: 'query User($id: ID!) { user(id: $id) { id } }', variables: { id: '42' } }) })
    expect(await (await session.handle(request))!.json()).toEqual({ data: { id: '42' } })
    expect(request.bodyUsed).toBe(false)
    expect(await session.handle(new Request('https://example.com/other'))).toBeUndefined()
    await session.dispose()
  })

  it('publishes GraphQL HTTP lifecycle events on the session bus', async () => {
    const session = createMockSession(graphql.query('User', () => HttpResponse.json({ data: { id: '42' } })))
    const lifecycle: Array<{ type: string, operation?: string, direction?: string }> = []
    for (const type of ['protocol:start', 'protocol:match', 'protocol:message', 'protocol:end'] as const) {
      session.events.on(type, (value) => {
        lifecycle.push({ type, operation: value.operation, direction: 'direction' in value ? value.direction : undefined })
      })
    }
    const response = await session.handle(new Request('https://example.com/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: 'query User { user { id } }' }),
    }))
    expect(await response!.json()).toEqual({ data: { id: '42' } })
    expect(lifecycle.map(({ type, operation, direction }) => [type, operation, direction])).toEqual([
      ['protocol:start', undefined, undefined],
      ['protocol:match', 'User', undefined],
      ['protocol:message', 'User', 'outbound'],
      ['protocol:end', 'User', undefined],
    ])
    await session.dispose()
  })

  it('applies the protocol unhandled callback before HTTP fallthrough', async () => {
    const callback = vi.fn(async (event, context) => {
      expect(event.protocol).toBe('graphql')
      expect(event.requestId).toBeTruthy()
      expect((await context.request()).url).toBe('https://example.com/graphql')
    })
    const session = createMockSession(graphql.query('User', () => HttpResponse.json({ data: { id: '42' } }), { onUnhandled: callback }))
    const unhandled = vi.fn()
    session.events.on('protocol:unhandled', unhandled)
    try {
      expect(await session.handle(new Request('https://example.com/graphql', {
        method: 'POST',
        body: JSON.stringify({ query: 'query Other { other }' }),
      }))).toBeUndefined()
      expect(callback).toHaveBeenCalledOnce()
      expect(unhandled).toHaveBeenCalledOnce()
    }
    finally {
      await session.dispose()
    }
  })

  it('routes malformed GraphQL HTTP payloads through the protocol policy', async () => {
    const callback = vi.fn(async (event, context) => {
      expect(event.protocol).toBe('graphql')
      expect(event.operation).toBeUndefined()
      expect(await (await context.request()).text()).toBe('{bad')
    })
    const lifecycle: string[] = []
    const session = createMockSession(graphql.query('User', () => HttpResponse.json({ data: { id: '42' } }), { onUnhandled: callback }))
    for (const type of ['protocol:start', 'protocol:error', 'protocol:unhandled', 'protocol:end'] as const) {
      session.events.on(type, () => lifecycle.push(type))
    }
    try {
      expect(await session.handle(new Request('https://example.com/graphql', {
        method: 'POST',
        body: '{bad',
      }))).toBeUndefined()
      expect(callback).toHaveBeenCalledOnce()
      expect(lifecycle).toEqual(['protocol:start', 'protocol:error', 'protocol:unhandled', 'protocol:end'])
    }
    finally {
      await session.dispose()
    }
  })

  it('defers protocol unhandled policies until sibling GraphQL handlers have been tried', async () => {
    const callback = vi.fn()
    const session = createMockSession(
      graphql.query('User', () => HttpResponse.json({ data: { id: '42' } }), { onUnhandled: callback }),
      graphql.mutation('Rename', () => HttpResponse.json({ data: { renamed: true } }), { onUnhandled: callback }),
    )
    try {
      const response = await session.handle(new Request('https://example.com/graphql', {
        method: 'POST',
        body: JSON.stringify({ query: 'mutation Rename { rename }' }),
      }))
      expect(await response!.json()).toEqual({ data: { renamed: true } })
      expect(callback).not.toHaveBeenCalled()
    }
    finally {
      await session.dispose()
    }
  })

  it('does not consume a once GraphQL handler when another operation handles the request', async () => {
    const session = createMockSession(
      graphql.query('User', () => HttpResponse.json({ data: 'user' }), { once: true }),
      graphql.query('Other', () => HttpResponse.json({ data: 'other' })),
    )
    const request = (query: string) => new Request('https://example.com/graphql', { method: 'POST', body: JSON.stringify({ query }) })
    try {
      expect(await (await session.handle(request('query Other { other }')))!.json()).toEqual({ data: 'other' })
      expect(await (await session.handle(request('query User { user }')))!.json()).toEqual({ data: 'user' })
    }
    finally {
      await session.dispose()
    }
  })

  it('executes schemas with validation and error responses', async () => {
    const session = createMockSession(createGraphQLHandler({
      schema: 'type Query { hello(name: String!): String! }',
      rootValue: { hello: ({ name }: { name: string }) => `Hello ${name}` },
    }))
    const request = (query: string) => new Request(`https://example.com/graphql?query=${encodeURIComponent(query)}`)
    expect(await (await session.handle(request('{ hello(name: "Ada") }')))!.json()).toEqual({ data: { hello: 'Hello Ada' } })
    const response = await session.handle(request('{ missing }'))
    expect(response!.status).toBe(400)
    expect(await response!.json()).toHaveProperty('errors')
    expect(await session.handle(request('not graphql'))).toBeUndefined()
    await session.dispose()
  })

  it('executes typed field resolvers with request context', async () => {
    const resolver = vi.fn(({ name }: { name: string }, context: { requestId: string }) => `${name}:${context.requestId}`)
    const session = createMockSession(createGraphQLHandler({
      schema: 'type Query { hello(name: String!): String! }',
      resolvers: { 'query.hello': resolver },
    }))
    const response = await session.handle(new Request('https://example.com/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: 'query Greeting($name: String!) { hello(name: $name) }', variables: { name: 'Ada' } }),
    }))
    expect(await response!.json()).toMatchObject({ data: { hello: expect.stringMatching(/^Ada:/) } })
    expect(resolver).toHaveBeenCalledWith({ name: 'Ada' }, expect.objectContaining({ query: expect.stringContaining('Greeting') }), expect.anything())
    await session.dispose()
  })

  it('accepts persisted operations in schema handlers', async () => {
    const query = 'query User($id: ID!) { user(id: $id) { id } }'
    const persisted = await createGraphQLPersistedOperations({ User: query })
    const session = createMockSession(createGraphQLHandler({
      schema: 'type User { id: ID! } type Query { user(id: ID!): User }',
      persisted,
      resolvers: { 'query.user': ({ id }) => ({ id }) },
    }))
    const hash = Object.keys(persisted)[0]!
    const response = await session.handle(new Request('https://example.com/graphql', {
      method: 'POST',
      body: JSON.stringify({ extensions: { persistedQuery: { version: 1, sha256Hash: hash } }, variables: { id: '42' } }),
    }))
    expect(await response!.json()).toEqual({ data: { user: { id: '42' } } })
    await session.dispose()
  })

  it('generates typed schema, argument and resolver declarations', () => {
    const source = generateGraphQLSource('type User { id: ID! } type Query { user(id: ID!): User } type Mutation { rename(id: ID!, name: String!): User }', {
      endpoint: '/api/graphql',
      operations: { User: 'query User($id: ID!) { user(id: $id) { id } }' },
    })
    expect(source).toContain('export const endpoint = "/api/graphql"')
    expect(source).toContain('export const persistedQueries =')
    expect(source).toContain('createPersistedHandlers')
    expect(source).toContain('export interface Query_userArgs')
    expect(source).toContain('export interface Mutation_renameArgs')
    expect(source).toContain('"query.user"?')
    expect(source).toContain('createGraphQLHandler')
  })

  it('executes the generated persisted handler factory', async () => {
    const source = generateGraphQLSource('type User { id: ID! } type Query { user(id: ID!): User }', {
      operations: { User: 'query User($id: ID!) { user(id: $id) { id } }' },
    })
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true })
    expect(compiled.diagnostics).toEqual([])
    const output: { createPersistedHandlers?: (resolvers: Record<string, unknown>) => Promise<HttpHandler[]> } = {}
    // eslint-disable-next-line no-new-func -- Execute generated source with the local GraphQL bridge.
    const evaluate = new Function('require', 'exports', compiled.outputText)
    evaluate((specifier: string) => {
      expect(specifier).toBe('mokup/graphql')
      return { createGraphQLHandler, createGraphQLPersistedOperations }
    }, output)
    const handlers = await output.createPersistedHandlers!({ 'query.user': ({ id }: { id: string }) => ({ id }) })
    const session = createMockSession(...handlers)
    const hash = Object.keys(await createGraphQLPersistedOperations({ User: 'query User($id: ID!) { user(id: $id) { id } }' }))[0]!
    const response = await session.handle(new Request('https://example.com/graphql', {
      method: 'POST',
      body: JSON.stringify({ extensions: { persistedQuery: { version: 1, sha256Hash: hash } }, variables: { id: '7' } }),
    }))
    expect(await response!.json()).toEqual({ data: { user: { id: '7' } } })
    await session.dispose()
  })

  it('resolves GraphQL automatic persisted queries without sending the document', async () => {
    const query = 'query User($id: ID!) { user(id: $id) { id } }'
    const operations = await createGraphQLPersistedOperations({ User: query })
    const hash = Object.keys(operations)[0]!
    expect(hash).toMatch(/^[a-f0-9]{64}$/u)
    const session = createMockSession(graphql.persisted('/graphql', operations, ({ variables }) => HttpResponse.json({ data: variables })))
    const response = await session.handle(new Request('https://example.com/graphql', {
      method: 'POST',
      body: JSON.stringify({ extensions: { persistedQuery: { version: 1, sha256Hash: hash } }, variables: { id: '42' } }),
    }))
    expect(await response!.json()).toEqual({ data: { id: '42' } })
    expect(await session.handle(new Request('https://example.com/graphql', { method: 'POST', body: JSON.stringify({ extensions: { persistedQuery: { version: 1, sha256Hash: 'missing' } } }) }))).toBeUndefined()
    await session.dispose()
  })

  it('streams GraphQL subscriptions over SSE and closes the iterator', async () => {
    const returned = vi.fn()
    const session = createMockSession(graphql.link('/graphql').subscription('Count', async function* () {
      try {
        yield { count: 1 }
        yield { count: 2 }
      }
      finally {
        returned()
      }
    }))
    const response = await session.handle(new Request('https://example.com/graphql', {
      method: 'POST',
      body: JSON.stringify({ query: 'subscription Count { count }' }),
    }))
    expect(response!.headers.get('content-type')).toBe('text/event-stream')
    expect(await response!.text()).toBe('event: next\ndata: {"data":{"count":1}}\n\nevent: next\ndata: {"data":{"count":2}}\n\nevent: complete\n\n')
    expect(returned).toHaveBeenCalledOnce()
    await session.dispose()
  })

  it('serves GraphQL subscriptions over graphql-transport-ws', async () => {
    const link = createGraphQLWebSocket('/graphql', {
      async* Count() {
        yield { count: 1 }
        yield { count: 2 }
      },
    })
    const controller = setupWebSocket(link)
    controller.start()
    try {
      const socket = new WebSocket('wss://example.com/graphql')
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true })
        socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true })
      })
      const ack = websocketMessage(socket)
      socket.send(JSON.stringify({ type: 'connection_init' }))
      const ackMessage = await ack
      expect(JSON.parse(ackMessage)).toEqual({ type: 'connection_ack' })
      const subscriptionMessages = new Promise<string[]>((resolve, reject) => {
        const messages: string[] = []
        const timer = setTimeout(() => reject(new Error('Timed out waiting for subscription completion.')), 2000)
        socket.addEventListener('message', (event) => {
          messages.push(String(event.data))
          if (messages.length === 3) {
            clearTimeout(timer)
            resolve(messages)
          }
        })
      })
      socket.send(JSON.stringify({ type: 'subscribe', id: 'count', payload: { query: 'subscription Count { count }' } }))
      const [first, second, complete] = await subscriptionMessages
      expect(JSON.parse(first!)).toEqual({ type: 'next', id: 'count', payload: { data: { count: 1 } } })
      expect(JSON.parse(second!)).toEqual({ type: 'next', id: 'count', payload: { data: { count: 2 } } })
      expect(JSON.parse(complete!)).toEqual({ type: 'complete', id: 'count' })
      socket.close()
    }
    finally {
      await controller.stop()
    }
  })

  it('applies the GraphQL WebSocket unhandled callback and preserves the request body', async () => {
    const callback = vi.fn(async (event, context) => {
      expect(event.protocol).toBe('graphql')
      expect(event.operation).toBe('Missing')
      expect(await (await context.request()).json()).toEqual({ query: 'subscription Missing { count }' })
    })
    const emit = vi.fn()
    const events = { emit } as unknown as Pick<HttpEvents, 'emit'>
    const link = createGraphQLWebSocket('/graphql', {}, { onUnhandled: callback, events })
    const controller = setupWebSocket(link)
    controller.start()
    try {
      const socket = new WebSocket('wss://example.com/graphql')
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true })
        socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true })
      })
      const response = websocketMessage(socket)
      socket.send(JSON.stringify({ type: 'subscribe', id: 'missing', payload: { query: 'subscription Missing { count }' } }))
      expect(JSON.parse(await response)).toMatchObject({ type: 'error', id: 'missing' })
      expect(callback).toHaveBeenCalledOnce()
      expect(emit.mock.calls.map(([type]) => type)).toEqual([
        'protocol:start',
        'protocol:message',
        'protocol:unhandled',
        'protocol:message',
        'protocol:end',
      ])
      socket.close()
    }
    finally {
      await controller.stop()
    }
  })

  it('reports GraphQL WebSocket unhandled errors without leaving a subscription alive', async () => {
    const emit = vi.fn()
    const events = { emit } as unknown as Pick<HttpEvents, 'emit'>
    const link = createGraphQLWebSocket('/graphql', {}, { onUnhandled: 'error', events })
    const controller = setupWebSocket(link)
    controller.start()
    try {
      const socket = new WebSocket('wss://example.com/graphql')
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true })
        socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true })
      })
      const response = websocketMessage(socket)
      socket.send(JSON.stringify({ type: 'subscribe', id: 'missing', payload: { query: 'subscription Missing { count }' } }))
      expect(JSON.parse(await response)).toMatchObject({ type: 'error', id: 'missing' })
      expect(emit.mock.calls.map(([type]) => type)).toEqual([
        'protocol:start',
        'protocol:message',
        'protocol:unhandled',
        'protocol:error',
        'protocol:message',
        'protocol:end',
      ])
      expect(link.clients).toHaveLength(1)
      socket.close()
    }
    finally {
      await controller.stop()
    }
  })
})

describe('SSE streams', () => {
  it('applies the SSE unhandled callback before HTTP fallthrough', async () => {
    const callback = vi.fn(async (event, context) => {
      expect(event.protocol).toBe('sse')
      expect((await context.request()).url).toBe('https://example.com/events')
    })
    const session = createMockSession(sse('/events', () => undefined, { onUnhandled: callback }))
    const lifecycle: string[] = []
    for (const type of ['protocol:start', 'protocol:unhandled', 'protocol:end'] as const) {
      session.events.on(type, () => lifecycle.push(type))
    }
    try {
      expect(await session.handle(new Request('https://example.com/events'))).toBeUndefined()
      expect(callback).toHaveBeenCalledOnce()
      expect(lifecycle).toEqual(['protocol:start', 'protocol:unhandled', 'protocol:end'])
    }
    finally {
      await session.dispose()
    }
  })

  it('publishes stream lifecycle and message events on the session bus', async () => {
    const session = createMockSession(sse('/events', async function* () {
      yield { data: { ready: true } }
    }))
    const lifecycle: Array<{ type: string, direction?: string }> = []
    for (const type of ['protocol:start', 'protocol:match', 'protocol:message', 'protocol:end'] as const) {
      session.events.on(type, (value) => {
        lifecycle.push({ type, direction: 'direction' in value ? value.direction : undefined })
      })
    }
    const response = await session.handle(new Request('https://example.com/events'))
    await response!.text()
    expect(lifecycle.map(({ type, direction }) => [type, direction])).toEqual([
      ['protocol:start', undefined],
      ['protocol:match', undefined],
      ['protocol:message', 'outbound'],
      ['protocol:end', undefined],
    ])
    await session.dispose()
  })

  it('encodes event boundaries and multiline data without buffering the iterator', async () => {
    const session = createMockSession(sse('/events', async function* () {
      yield { event: 'message', id: '1', data: 'hello\nworld', retry: 100 }
      yield { data: { done: true } }
    }))
    const response = await session.handle(new Request('https://example.com/events'))
    expect(response!.headers.get('content-type')).toBe('text/event-stream')
    expect(await response!.text()).toBe('event: message\nid: 1\nretry: 100\ndata: hello\ndata: world\n\ndata: {"done":true}\n\n')
    await session.dispose()
  })

  it('cleans up on consumer cancellation and request abort', async () => {
    const returned = vi.fn()
    async function* source() {
      try {
        while (true) {
          yield { data: 'hello' }
        }
      }
      finally {
        returned()
      }
    }
    const response = eventStream(source())
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    expect(returned).toHaveBeenCalledTimes(1)
    const controller = new AbortController()
    const aborted = eventStream(source(), {}, controller.signal).body!.getReader()
    await aborted.read()
    controller.abort(new Error('cancelled'))
    await expect(aborted.read()).rejects.toThrow('cancelled')
    await Promise.resolve()
    expect(returned).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid event framing', async () => {
    await expect(eventStream([{ event: 'a\nb', data: 'x' }]).text()).rejects.toThrow('newlines')
    await expect(eventStream([{ retry: -1 }]).text()).rejects.toThrow('non-negative')
  })
})
