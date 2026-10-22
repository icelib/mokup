import type { DocumentNode, GraphQLResolveInfo, GraphQLSchema } from 'graphql'
import type { HttpEvents, HttpHandlerOptions, HttpMatcher, HttpResolverContext, HttpResolverResult, ProtocolEvent, ProtocolUnhandledPolicy } from './http'
import type { WebSocketLink, WebSocketMatcher } from './ws'
import { buildSchema, execute, getOperationAST, parse, print, validate } from 'graphql'
import { http, HttpResponse } from './http'
import { applyProtocolUnhandledPolicy, protocolUnhandled } from './protocol-policy'
import { eventStream } from './sse'
import { ws } from './ws'

export { generateGraphQLSource } from './graphql/source'

export interface GraphQLResolverContext extends HttpResolverContext {
  operationName: string | undefined
  query: string
  variables: Record<string, unknown>
}

export type GraphQLResolver = (context: GraphQLResolverContext) => HttpResolverResult | Promise<HttpResolverResult>
export type GraphQLMatcher = string | RegExp | DocumentNode

export type GraphQLFieldResolver = (args: Record<string, unknown>, context: GraphQLResolverContext, info: GraphQLResolveInfo) => unknown | Promise<unknown>
export type GraphQLFieldResolvers = Record<string, GraphQLFieldResolver | undefined>
export type GraphQLPersistedOperations = Readonly<Record<string, string>>
export type GraphQLSubscriptionResolver = (context: GraphQLResolverContext) => AsyncIterable<unknown> | Iterable<unknown> | Promise<AsyncIterable<unknown> | Iterable<unknown>>
export interface GraphQLWebSocketOptions {
  persisted?: GraphQLPersistedOperations
  events?: Pick<HttpEvents, 'emit'>
  onUnhandled?: ProtocolUnhandledPolicy
}

export interface GraphQLHttpOptions extends HttpHandlerOptions {
  onUnhandled?: ProtocolUnhandledPolicy
}

/** Return the SHA-256 hex digest used by the GraphQL Automatic Persisted Queries protocol. */
export async function hashGraphQLQuery(query: string): Promise<string> {
  const crypto = globalThis.crypto
  if (!crypto?.subtle) {
    throw new TypeError('GraphQL persisted operations require Web Crypto (crypto.subtle).')
  }
  const bytes = new TextEncoder().encode(query)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

/** Normalize and hash named queries into a map accepted by `graphql.persisted()`. */
export async function createGraphQLPersistedOperations(queries: Record<string, string>): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const query of Object.values(queries)) {
    const normalized = print(parse(query))
    result[await hashGraphQLQuery(query)] = query
    if (normalized !== query) {
      result[await hashGraphQLQuery(normalized)] = normalized
    }
  }
  return result
}

async function readOperation(request: Request, persisted?: GraphQLPersistedOperations) {
  const url = new URL(request.url)
  const payload: Record<string, unknown> = request.method === 'GET'
    ? {
        query: url.searchParams.get('query'),
        operationName: url.searchParams.get('operationName'),
        variables: JSON.parse(url.searchParams.get('variables') ?? '{}'),
      }
    : await request.json() as Record<string, unknown>
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }
  const extensions = payload['extensions']
  const persistedQuery = extensions && typeof extensions === 'object' && !Array.isArray(extensions)
    ? (extensions as Record<string, unknown>)['persistedQuery']
    : undefined
  const hash = persistedQuery && typeof persistedQuery === 'object' && !Array.isArray(persistedQuery)
    ? (persistedQuery as Record<string, unknown>)['sha256Hash']
    : typeof payload['persistedHash'] === 'string' ? payload['persistedHash'] : undefined
  const query = typeof payload['query'] === 'string' ? payload['query'] : typeof hash === 'string' ? persisted?.[hash] : undefined
  if (typeof query !== 'string') {
    return undefined
  }
  const document = parse(query)
  const operationName = typeof payload['operationName'] === 'string' ? payload['operationName'] : undefined
  const operation = getOperationAST(document, operationName)
  if (!operation) {
    return undefined
  }
  const variables = payload['variables'] ?? {}
  if (typeof variables !== 'object' || Array.isArray(variables)) {
    return undefined
  }
  return { query, document, operation, operationName: operation.name?.value, variables: variables as Record<string, unknown> }
}

function matchesOperation(input: Awaited<ReturnType<typeof readOperation>>, kind: 'query' | 'mutation' | 'subscription' | undefined, name: GraphQLMatcher | undefined) {
  if (!input || (kind && input.operation.operation !== kind)) {
    return false
  }
  if (name instanceof RegExp) {
    const expression = new RegExp(name.source, name.flags.replace(/[gy]/g, ''))
    return expression.test(input.operationName ?? '')
  }
  if (typeof name === 'string') {
    return input.operationName === name
  }
  return !name || print(name) === print(input.document)
}

function subscriptionResult(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && (Object.hasOwn(value, 'data') || Object.hasOwn(value, 'errors'))) {
    return value
  }
  return { data: value }
}

function createGraphQL(endpoint: HttpMatcher, persisted?: GraphQLPersistedOperations) {
  function handler(kind: 'query' | 'mutation' | undefined, name: GraphQLMatcher | undefined, resolver: GraphQLResolver, options?: GraphQLHttpOptions) {
    return http.all(endpoint, async (context) => {
      if (!['GET', 'POST'].includes(context.request.method)) {
        return
      }
      const eventBus = context.events
      const baseEvent: ProtocolEvent = {
        requestId: context.requestId,
        method: context.request.method,
        url: context.request.url,
        protocol: 'graphql',
        connectionId: context.requestId,
      }
      eventBus?.emit('protocol:start', baseEvent)
      let input: Awaited<ReturnType<typeof readOperation>>
      try {
        input = await readOperation(context.request.clone(), persisted)
      }
      catch (error) {
        eventBus?.emit('protocol:error', { ...baseEvent, error })
        return protocolUnhandled(baseEvent, 'Invalid GraphQL request payload.', options?.onUnhandled)
      }
      if (!input || !matchesOperation(input, kind, name) || input.operation.operation === 'subscription') {
        return protocolUnhandled(baseEvent, 'No GraphQL operation matched this handler.', options?.onUnhandled)
      }
      const operationEvent = input.operationName ? { ...baseEvent, operation: input.operationName } : baseEvent
      eventBus?.emit('protocol:match', operationEvent)
      try {
        const result = await resolver({ ...context, query: input.query, operationName: input.operationName, variables: input.variables })
        if (result instanceof Response) {
          eventBus?.emit('protocol:message', { ...operationEvent, direction: 'outbound', data: { status: result.status } })
        }
        return result
      }
      catch (error) {
        eventBus?.emit('protocol:error', { ...operationEvent, error })
        throw error
      }
      finally {
        eventBus?.emit('protocol:end', operationEvent)
      }
    }, options)
  }
  function subscription(name: GraphQLMatcher, resolver: GraphQLSubscriptionResolver, options?: GraphQLHttpOptions) {
    return http.all(endpoint, async (context) => {
      if (!['GET', 'POST'].includes(context.request.method)) {
        return
      }
      const eventBus = context.events
      const baseEvent: ProtocolEvent = {
        requestId: context.requestId,
        method: context.request.method,
        url: context.request.url,
        protocol: 'graphql',
        connectionId: context.requestId,
      }
      eventBus?.emit('protocol:start', baseEvent)
      let input: Awaited<ReturnType<typeof readOperation>>
      try {
        input = await readOperation(context.request.clone(), persisted)
      }
      catch (error) {
        eventBus?.emit('protocol:error', { ...baseEvent, error })
        return protocolUnhandled(baseEvent, 'Invalid GraphQL request payload.', options?.onUnhandled)
      }
      if (!input || !matchesOperation(input, 'subscription', name)) {
        return protocolUnhandled(baseEvent, 'No GraphQL subscription matched this handler.', options?.onUnhandled)
      }
      const operationEvent = input.operationName ? { ...baseEvent, operation: input.operationName } : baseEvent
      eventBus?.emit('protocol:match', operationEvent)
      const graphQLContext = { ...context, query: input.query, operationName: input.operationName, variables: input.variables }
      async function* streamEvents() {
        try {
          const source = await resolver(graphQLContext)
          for await (const value of source) {
            const data = subscriptionResult(value)
            eventBus?.emit('protocol:message', { ...operationEvent, direction: 'outbound', data })
            yield { event: 'next', data }
          }
        }
        catch (error) {
          eventBus?.emit('protocol:error', { ...operationEvent, error })
          throw error
        }
        finally {
          eventBus?.emit('protocol:end', operationEvent)
        }
        yield { event: 'complete' }
      }
      return eventStream(streamEvents(), {}, context.request.signal)
    }, options)
  }
  return {
    query: (name: GraphQLMatcher, resolver: GraphQLResolver, options?: GraphQLHttpOptions) => handler('query', name, resolver, options),
    mutation: (name: GraphQLMatcher, resolver: GraphQLResolver, options?: GraphQLHttpOptions) => handler('mutation', name, resolver, options),
    operation: (resolver: GraphQLResolver, options?: GraphQLHttpOptions) => handler(undefined, undefined, resolver, options),
    subscription,
  }
}

/**
 * Handle the graphql-transport-ws protocol over Mokup's WebSocket link.
 * Each subscription uses the same parsed operation and resolver contract as HTTP/SSE.
 */
export function createGraphQLWebSocket(
  endpoint: WebSocketMatcher,
  resolvers: Record<string, GraphQLSubscriptionResolver>,
  options: GraphQLWebSocketOptions = {},
): WebSocketLink {
  const link = ws.link(endpoint)
  link.addEventListener('connection', (connection) => {
    connection.server.connect()
    const subscriptions = new Map<string, AbortController>()
    const closeSubscriptions = () => {
      for (const controller of subscriptions.values()) {
        controller.abort(new DOMException('GraphQL WebSocket connection closed.', 'AbortError'))
      }
      subscriptions.clear()
    }
    connection.signal.addEventListener('abort', closeSubscriptions, { once: true })
    connection.client.addEventListener('close', closeSubscriptions, { once: true })
    const send = (value: unknown, event?: ProtocolEvent) => {
      if (!connection.signal.aborted) {
        connection.client.send(JSON.stringify(value))
        if (event) {
          options.events?.emit('protocol:message', { ...event, direction: 'outbound', data: value })
        }
      }
    }
    const run = async (id: string, payload: unknown) => {
      const requestId = globalThis.crypto?.randomUUID?.() ?? `graphql-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const baseEvent: ProtocolEvent = {
        requestId,
        method: 'POST',
        url: 'https://mokup.invalid/graphql',
        protocol: 'graphql',
        connectionId: String(connection.client.id),
      }
      const requestEvent: ProtocolEvent = { ...baseEvent, operation: id }
      options.events?.emit('protocol:start', requestEvent)
      options.events?.emit('protocol:message', { ...requestEvent, direction: 'inbound', data: payload })
      const controller = new AbortController()
      const abortWithConnection = () => controller.abort(connection.signal.reason)
      connection.signal.addEventListener('abort', abortWithConnection, { once: true })
      const request = new Request('https://mokup.invalid/graphql', { method: 'POST', body: JSON.stringify(payload), signal: controller.signal })
      const unhandled = async (event: ProtocolEvent, message: string) => {
        options.events?.emit('protocol:unhandled', { ...event, reason: message })
        try {
          await applyProtocolUnhandledPolicy(options.onUnhandled, event, {
            signal: controller.signal,
            request: async () => request.clone(),
          })
        }
        catch (error) {
          if (!controller.signal.aborted) {
            options.events?.emit('protocol:error', { ...event, error })
          }
        }
        if (!controller.signal.aborted) {
          send({ type: 'error', id, payload: [{ message }] }, event)
        }
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        await unhandled(requestEvent, 'Subscription payload must be an object.')
        connection.signal.removeEventListener('abort', abortWithConnection)
        options.events?.emit('protocol:end', requestEvent)
        return
      }
      let input: Awaited<ReturnType<typeof readOperation>>
      try {
        input = await readOperation(request.clone(), options.persisted)
      }
      catch (error) {
        options.events?.emit('protocol:error', { ...requestEvent, error })
        connection.signal.removeEventListener('abort', abortWithConnection)
        send({ type: 'error', id, payload: [{ message: error instanceof Error ? error.message : String(error) }] }, requestEvent)
        options.events?.emit('protocol:end', requestEvent)
        return
      }
      if (!input || input.operation.operation !== 'subscription') {
        await unhandled(requestEvent, 'A valid GraphQL subscription operation is required.')
        connection.signal.removeEventListener('abort', abortWithConnection)
        options.events?.emit('protocol:end', requestEvent)
        return
      }
      const resolver = input.operation.name?.value ? resolvers[input.operation.name.value] : undefined
      if (!resolver) {
        const operationEvent = input.operation.name?.value ? { ...requestEvent, operation: input.operation.name.value } : requestEvent
        await unhandled(operationEvent, `No mock resolver for subscription ${input.operation.name?.value ?? '<anonymous>'}.`)
        connection.signal.removeEventListener('abort', abortWithConnection)
        options.events?.emit('protocol:end', operationEvent)
        return
      }
      const operationEvent = input.operation.name?.value ? { ...requestEvent, operation: input.operation.name.value } : requestEvent
      options.events?.emit('protocol:match', operationEvent)
      subscriptions.set(id, controller)
      const context = {
        request,
        cookies: {},
        params: {},
        requestId,
        finalize(cleanup: () => void | Promise<void>) {
          if (controller.signal.aborted) {
            void cleanup()
          }
          else {
            controller.signal.addEventListener('abort', () => void cleanup(), { once: true })
          }
        },
        query: input.query,
        operationName: input.operationName,
        variables: input.variables,
      } satisfies Omit<GraphQLResolverContext, 'request'> & { request: Request } as GraphQLResolverContext
      try {
        const source = await resolver(context)
        for await (const value of source) {
          if (controller.signal.aborted) {
            break
          }
          send({ type: 'next', id, payload: subscriptionResult(value) }, operationEvent)
        }
        if (!controller.signal.aborted) {
          send({ type: 'complete', id }, operationEvent)
        }
      }
      catch (error) {
        if (!controller.signal.aborted) {
          options.events?.emit('protocol:error', { ...operationEvent, error })
          send({ type: 'error', id, payload: [{ message: error instanceof Error ? error.message : String(error) }] }, operationEvent)
        }
      }
      finally {
        if (subscriptions.get(id) === controller) {
          subscriptions.delete(id)
        }
        connection.signal.removeEventListener('abort', abortWithConnection)
        options.events?.emit('protocol:end', operationEvent)
      }
    }
    connection.client.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        return
      }
      let message: unknown
      try {
        message = JSON.parse(event.data)
      }
      catch {
        send({ type: 'error', payload: [{ message: 'WebSocket message must be valid JSON.' }] })
        return
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return
      }
      const value = message as Record<string, unknown>
      const id = typeof value['id'] === 'string' ? value['id'] : undefined
      if (value['type'] === 'connection_init') {
        send({ type: 'connection_ack' })
      }
      else if (value['type'] === 'ping') {
        send({ type: 'pong', payload: value['payload'] })
      }
      else if (value['type'] === 'complete' && id) {
        subscriptions.get(id)?.abort(new DOMException('GraphQL subscription completed by client.', 'AbortError'))
        subscriptions.delete(id)
      }
      else if (value['type'] === 'subscribe' && id) {
        subscriptions.get(id)?.abort(new DOMException('GraphQL subscription replaced.', 'AbortError'))
        void run(id, value['payload'])
      }
    })
  })
  return link
}

export const graphql = {
  ...createGraphQL('*'),
  link: createGraphQL,
  persisted: (endpoint: HttpMatcher, operations: GraphQLPersistedOperations, resolver: GraphQLResolver, options?: GraphQLHttpOptions) => createGraphQL(endpoint, operations).operation(resolver, options),
  websocket: createGraphQLWebSocket,
}

/** Execute a schema with user-provided resolvers using the same HTTP session. */
export function createGraphQLHandler(options: {
  schema: string | GraphQLSchema
  rootValue?: unknown
  contextValue?: unknown
  resolvers?: GraphQLFieldResolvers
  endpoint?: HttpMatcher
  persisted?: GraphQLPersistedOperations
}) {
  const schema = typeof options.schema === 'string' ? buildSchema(options.schema) : options.schema
  return createGraphQL(options.endpoint ?? '/graphql', options.persisted).operation(async (context) => {
    const { query, operationName, variables } = context
    const document = parse(query)
    const operation = getOperationAST(document, operationName)
    if (!operation) {
      return
    }
    const errors = validate(schema, document)
    if (errors.length) {
      return HttpResponse.json({ errors: errors.map(error => error.toJSON()) }, { status: 400 })
    }
    const rootType = operation.operation === 'mutation' ? schema.getMutationType() : schema.getQueryType()
    const rootValue = options.resolvers && rootType
      ? Object.fromEntries(Object.keys(rootType.getFields()).map((fieldName) => {
          const resolver = options.resolvers?.[`${operation.operation}.${fieldName}`] ?? options.resolvers?.[fieldName]
          return [fieldName, (args: Record<string, unknown>, _context: unknown, info: GraphQLResolveInfo) => resolver?.(args, context, info)]
        }))
      : options.rootValue
    const result = await execute({
      schema,
      document,
      rootValue,
      contextValue: options.contextValue ?? context,
      variableValues: variables,
      operationName,
    })
    return HttpResponse.json(result)
  })
}
