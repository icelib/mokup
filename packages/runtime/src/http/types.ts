export type HttpParamValue = string | string[]
export type HttpParams = Record<string, HttpParamValue>
export type HttpCookies = Record<string, string>

export interface HttpRequestContext {
  /** Materialize a transport-owned upload only when a predicate or resolver needs it. */
  loadRequest?: (signal: AbortSignal) => Promise<Request>
  /** Mount prefix for relative URL matchers; resolvers and events retain the original URL. */
  basePath?: string
  /** Cookies supplied by a transport that cannot expose the Cookie request header. */
  cookies?: HttpCookies
  /** Transport-defined context, such as Worker bindings and an execution context. */
  context?: unknown
}

export declare const responseBodyType: unique symbol

export interface StrictResponse<Body> extends Response {
  readonly [responseBodyType]: Body
  json: () => Promise<Body>
}

export type TypedRequest<Body = never> = [Body] extends [never] ? Request : Omit<Request, 'json'> & { json: () => Promise<Body> }

export interface HttpPredicateContext {
  request: Request
  cookies: HttpCookies
}

export type HttpPredicate = (context: HttpPredicateContext) =>
  boolean | { matches: boolean, params?: HttpParams }
  | Promise<boolean | { matches: boolean, params?: HttpParams }>

export type HttpMatcher = string | RegExp | HttpPredicate
export type HttpCleanup = () => void | Promise<void>

export interface HttpResolverContext<Params extends Record<keyof Params, HttpParamValue> = HttpParams, RequestBody = never> {
  request: TypedRequest<RequestBody>
  cookies: HttpCookies
  params: Params
  requestId: string
  context?: unknown
  /** Shared lifecycle bus for protocol-aware handlers such as GraphQL and SSE. */
  events?: Pick<HttpEvents, 'emit'>
  scenario?: HttpScenario
  /** Release resources when the response settles, the request aborts, or the session closes. */
  finalize: (cleanup: HttpCleanup) => void
}

export interface PassthroughResult {
  readonly kind: 'mokup:passthrough'
}

export type HttpResolverResult<ResponseBody = never> = ([ResponseBody] extends [never] ? Response : StrictResponse<ResponseBody>) | PassthroughResult | ProtocolUnhandledResult | undefined | void
export type HttpResolverIterable<ResponseBody = never> = Iterable<HttpResolverResult<ResponseBody> | Promise<HttpResolverResult<ResponseBody>>> | AsyncIterable<HttpResolverResult<ResponseBody>>
export type HttpResolverReturn<ResponseBody = never> = HttpResolverResult<ResponseBody> | HttpResolverIterable<ResponseBody>
export type HttpResolver<Params extends Record<keyof Params, HttpParamValue> = HttpParams, RequestBody = never, ResponseBody = never> = (context: HttpResolverContext<Params, RequestBody>) => HttpResolverReturn<ResponseBody> | Promise<HttpResolverReturn<ResponseBody>>

export interface HttpHandlerOptions {
  once?: boolean
}

/** Execution policy supplied by compatibility adapters; native handlers use finite sequences. */
export interface HttpExecutionOptions {
  relativeUrls?: 'pathname' | 'page'
  consumeOnce?: 'response' | 'execution'
  sequence?: 'finite' | 'repeat-last'
  onceSequence?: 'response' | 'exhaustion'
}

/** Immutable definition. Consumption and other mutable state belong to sessions. */
export interface HttpHandler {
  readonly method: string | RegExp
  readonly matcher: HttpMatcher
  readonly resolver: HttpResolver
  readonly once: boolean
  readonly execution?: Readonly<HttpExecutionOptions>
  /** Run transport middleware around one session-owned resolver step. */
  readonly execute?: (context: HttpResolverContext, resolve: (context?: HttpResolverContext) => Promise<HttpResolverResult>) => Promise<HttpResolverResult>
}

export type MockHandler = HttpHandler

/** Events expose metadata, so observing requests cannot consume application streams. */
export interface HttpRequestEvent {
  readonly requestId: string
  readonly method: string
  readonly url: string
  /** Clone owned by the lifecycle emitter; consuming it does not consume the transport request. */
  readonly request?: Request
}

export type MockProtocol = 'graphql' | 'sse' | 'websocket'

export interface ProtocolEvent extends HttpRequestEvent {
  readonly protocol: MockProtocol
  readonly connectionId?: string
  readonly matcher?: string
  readonly operation?: string
  readonly direction?: 'inbound' | 'outbound'
  readonly data?: unknown
}

/**
 * A protocol handler can report an operation miss without claiming the HTTP
 * request. The session defers the protocol policy until every HTTP candidate
 * has had a chance to handle the request.
 */
export interface ProtocolUnhandledResult {
  readonly kind: 'mokup:protocol-unhandled'
  readonly event: ProtocolEvent
  readonly reason: string
  readonly policy?: ProtocolUnhandledPolicy
}

export type HttpMatchDecisionResult = 'method-mismatch' | 'once-exhausted' | 'matcher-mismatch' | 'matcher-error' | 'matched'

export interface HttpMatchDecision {
  readonly method: string
  readonly matcher: string
  readonly once: boolean
  readonly result: HttpMatchDecisionResult
  readonly detail?: string
}

export interface HttpEventMap {
  'request:start': HttpRequestEvent
  'request:match': HttpRequestEvent & { readonly handler: HttpHandler }
  'request:unhandled': HttpRequestEvent & { readonly decisionChain: readonly HttpMatchDecision[] }
  'request:end': HttpRequestEvent
  'response:mocked': HttpRequestEvent & { readonly handler: HttpHandler, readonly status: number, readonly response?: Response }
  'response:bypass': HttpRequestEvent
  'unhandledException': HttpRequestEvent & { readonly error: unknown }
  'protocol:start': ProtocolEvent
  'protocol:match': ProtocolEvent
  'protocol:unhandled': ProtocolEvent & { readonly reason: string }
  'protocol:end': ProtocolEvent
  'protocol:error': ProtocolEvent & { readonly error: unknown }
  'protocol:message': ProtocolEvent
}

export interface HttpEvents {
  on: <T extends keyof HttpEventMap>(type: T, listener: (event: HttpEventMap[T]) => void) => () => void
  off: <T extends keyof HttpEventMap>(type: T, listener: (event: HttpEventMap[T]) => void) => void
  removeListener: HttpEvents['off']
  removeAllListeners: (type?: keyof HttpEventMap) => void
  /** Emit a protocol event from an adapter while preserving shared subscriptions. */
  emit: <T extends keyof HttpEventMap>(type: T, event: HttpEventMap[T]) => void
}

export interface UnhandledRequestContext {
  signal: AbortSignal
  /** Read an independent upload copy only when the callback asks for it. */
  request: () => Promise<Request>
}

/** Minimal scenario catalog surface exposed to handlers and adapters. */
export interface HttpScenario {
  readonly names: () => readonly string[]
  readonly active: () => string
  readonly current: () => { readonly getState: () => unknown }
  readonly select: (name: string) => { readonly getState: () => unknown }
  readonly reset: () => void
  readonly fork?: () => HttpScenario
}

export type UnhandledRequestPolicy = 'bypass' | 'warn' | 'error'
  | ((event: HttpRequestEvent, context: UnhandledRequestContext) => void | Promise<void>)

/** The same unhandled policy shape for protocol handlers layered on HTTP. */
export type ProtocolUnhandledPolicy = 'bypass' | 'warn' | 'error'
  | ((event: ProtocolEvent, context: UnhandledRequestContext) => void | Promise<void>)

export interface MockSessionOptions {
  handlers?: readonly HttpHandler[]
  onUnhandled?: UnhandledRequestPolicy
  scenario?: HttpScenario
}

export interface MockSession {
  /** Aborts when the session closes; transports share this lifetime with body readers. */
  readonly signal: AbortSignal
  handle: (request: Request, context?: HttpRequestContext) => Promise<Response | undefined>
  use: (...handlers: HttpHandler[]) => void
  /** Remove exact definitions without resetting unrelated overrides or once state. */
  removeHandlers: (...handlers: HttpHandler[]) => void
  resetHandlers: (...handlers: HttpHandler[]) => void
  /** Replace file-derived initial definitions while retaining temporary overrides and their state. */
  replaceInitialHandlers: (...handlers: HttpHandler[]) => void
  /** Restore once definitions without restarting ordinary sequences or cancelling live responses. */
  restoreHandlers: () => void
  listHandlers: () => readonly HttpHandler[]
  setOnUnhandled: (policy: UnhandledRequestPolicy) => void
  /** Scenario controls are session-owned, so parallel forks can select independently. */
  readonly scenario?: HttpScenario
  selectScenario: (name: string) => void
  resetScenario: () => void
  /** Snapshot current definitions into an independent session that shares event subscriptions. */
  fork: () => MockSession
  events: HttpEvents
  dispose: () => Promise<void>
}
