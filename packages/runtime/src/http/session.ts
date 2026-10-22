import type {
  HttpCleanup,
  HttpHandler,
  HttpMatchDecision,
  HttpMatchDecisionResult,
  HttpParams,
  HttpRequestContext,
  HttpRequestEvent,
  HttpResolverContext,
  HttpResolverResult,
  MockSession,
  MockSessionOptions,
  ProtocolUnhandledResult,
  UnhandledRequestContext,
  UnhandledRequestPolicy,
} from './types'
import { applyProtocolUnhandledPolicy } from '../protocol-policy'
import { createHttpEvents } from './events'
import { executeHandler } from './execute'
import { isResponse } from './is-response'
import { matchesMethod, matchHandler, needsPredicateBody, readCookies } from './matcher'
import { createLazyRequest, withRequestSignal } from './request'
import { createResolverRunner } from './resolver'
import { createRequestResources, withAbort } from './resources'
import { copyResponseCookies } from './response-cookies'

interface HandlerState {
  used: boolean
  requests: number
  retiring: boolean
  closed: boolean
  pending?: Promise<void> | undefined
  runner: ReturnType<typeof createResolverRunner>
}

function isProtocolUnhandled(value: HttpResolverResult | undefined): value is ProtocolUnhandledResult {
  return Boolean(value && typeof value === 'object' && 'kind' in value && value.kind === 'mokup:protocol-unhandled')
}

function cloneLifecycleRequest(request: Request): Request {
  try {
    return request.clone()
  }
  catch {
    return request
  }
}

function freezeLifecycleEvent<T extends object>(event: T, request?: Request): T & { readonly request?: Request } {
  if (request) {
    let clone: Request | undefined
    Object.defineProperty(event, 'request', {
      configurable: false,
      enumerable: false,
      get() {
        clone ??= cloneLifecycleRequest(request)
        return clone
      },
    })
  }
  return Object.freeze(event)
}

/**
 * Enforce Fetch's bodyless status contract for native HTTP handlers as well as
 * file-route overrides. Fetch permits a few framing headers on a 304 because
 * they describe the selected representation, while 204/205 must not carry
 * payload framing from the resolver's discarded response.
 */
async function normalizeBodylessResponse(response: Response): Promise<Response> {
  if (![204, 205, 304].includes(response.status)) {
    return response
  }
  const headers = new Headers(response.headers)
  if (response.status === 204 || response.status === 205) {
    headers.delete('content-length')
    headers.delete('transfer-encoding')
  }
  if (!response.body && headers.get('content-length') === response.headers.get('content-length')) {
    return response
  }
  // A resolver can only return a bodyless Response for these statuses on
  // current Fetch implementations, but cancelling here also covers custom
  // Response-like implementations and keeps stream producers owned by the
  // request scope.
  await response.body?.cancel().catch(() => undefined)
  return copyResponseCookies(response, new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }))
}

async function handleUnhandled(policy: UnhandledRequestPolicy, event: HttpRequestEvent, context: UnhandledRequestContext) {
  if (typeof policy === 'function') {
    await policy(event, context)
    return
  }
  const message = `[mokup] Unhandled request: ${event.method} ${event.url}`
  if (policy === 'error') {
    throw new Error(message)
  }
  if (policy === 'warn') {
    // eslint-disable-next-line no-console -- Explicit warning policy is part of the session API.
    console.warn(message)
  }
}

export function buildSession(options: MockSessionOptions, emitter = createHttpEvents(), initial = [...options.handlers ?? []]): MockSession {
  let handlers = [...options.handlers ?? []]
  let states = new WeakMap<HttpHandler, HandlerState>()
  let policy = options.onUnhandled ?? 'bypass'
  const scenario = options.scenario?.fork?.() ?? options.scenario
  const lifetime = new AbortController()
  const activeStates = new Set<HandlerState>()
  const retiring = new Set<Promise<void>>()
  const retirementErrors: unknown[] = []
  const tasks = new Set<Promise<Response | undefined>>()
  const resources = new Set<HttpCleanup>()
  let disposal: Promise<void> | undefined
  let sequence = 0

  const assertActive = () => {
    if (lifetime.signal.aborted) {
      throw new Error('Cannot use a disposed mock session.')
    }
  }
  const getState = (handler: HttpHandler) => {
    let state = states.get(handler)
    if (!state) {
      state = { used: false, requests: 0, retiring: false, closed: false, runner: createResolverRunner(lifetime.signal, handler.execution) }
      states.set(handler, state)
      activeStates.add(state)
    }
    return state
  }
  const retire = (state: HandlerState, graceful = false) => {
    if (state.closed) {
      return
    }
    if (graceful && state.requests > 0) {
      state.retiring = true
      return
    }
    state.closed = true
    activeStates.delete(state)
    const task = state.runner.close()
    retiring.add(task)
    void task.then(() => retiring.delete(task), (error: unknown) => {
      retiring.delete(task)
      retirementErrors.push(error)
    })
  }

  async function resolve(request: Request, context: HttpRequestContext = {}): Promise<Response | undefined> {
    assertActive()
    const controller = new AbortController()
    const abortRequest = () => controller.abort(request.signal.reason)
    const abortSession = () => controller.abort(lifetime.signal.reason)
    request.signal.addEventListener('abort', abortRequest, { once: true })
    lifetime.signal.addEventListener('abort', abortSession, { once: true })
    if (request.signal.aborted) {
      abortRequest()
    }
    const signal = controller.signal
    let resolutionDone = false
    const ownedResources = new Set<HttpCleanup>()
    const detach = () => {
      if (resolutionDone && ownedResources.size === 0) {
        request.signal.removeEventListener('abort', abortRequest)
        lifetime.signal.removeEventListener('abort', abortSession)
      }
    }
    const event = freezeLifecycleEvent({
      requestId: `${crypto.randomUUID?.() ?? Date.now().toString(36)}-${++sequence}`,
      method: request.method,
      url: request.url,
    }, request)
    const decisionChain: HttpMatchDecision[] = []
    const protocolMisses: ProtocolUnhandledResult[] = []
    const finishProtocolMisses = () => {
      for (const miss of protocolMisses.splice(0)) {
        emitter.emit('protocol:end', miss.event)
      }
    }
    const describeMatcher = (handler: HttpHandler) => typeof handler.matcher === 'string'
      ? handler.matcher
      : handler.matcher instanceof RegExp ? handler.matcher.toString() : '[predicate]'
    const recordDecision = (handler: HttpHandler, result: HttpMatchDecisionResult, detail?: string) => {
      decisionChain.push({
        method: String(handler.method),
        matcher: describeMatcher(handler),
        once: handler.once,
        result,
        ...(detail ? { detail } : {}),
      })
    }
    const cookies = { ...context.cookies, ...readCookies(request) }
    const candidates = [...handlers]
    const loadRequest = createLazyRequest(request, context, signal)
    try {
      emitter.emit('request:start', event)
      signal.throwIfAborted()
      for (const handler of candidates) {
        if (!matchesMethod(handler, request.method)) {
          recordDecision(handler, 'method-mismatch', `request method ${request.method} does not match handler method ${String(handler.method)}`)
          continue
        }
        if (handler.once && states.get(handler)?.used) {
          recordDecision(handler, 'once-exhausted', 'handler has already been consumed in this session')
          continue
        }
        let params: HttpParams | null
        try {
          const input = needsPredicateBody(handler) ? await loadRequest() : request
          const match = matchHandler(handler, input, cookies, signal, context.basePath)
          params = match instanceof Promise ? await withAbort(match, signal) : match
        }
        catch (error) {
          recordDecision(handler, 'matcher-error', error instanceof Error ? error.message : String(error))
          throw error
        }
        if (!params) {
          recordDecision(handler, 'matcher-mismatch', 'handler matcher returned no match')
          continue
        }
        const state = getState(handler)
        if (handler.once) {
          while (state.pending) {
            await withAbort(state.pending, signal)
          }
          if (state.used) {
            recordDecision(handler, 'once-exhausted', 'handler was consumed while this request was waiting')
            continue
          }
        }
        recordDecision(handler, 'matched')
        let unlock: (() => void) | undefined
        if (handler.once) {
          state.pending = new Promise<void>((resolve) => {
            unlock = resolve
          })
        }
        const scope = createRequestResources(signal, (cleanup) => {
          resources.delete(cleanup)
          ownedResources.delete(cleanup)
          detach()
        })
        resources.add(scope.finish)
        ownedResources.add(scope.finish)
        state.requests++
        scope.finalize(() => {
          state.requests--
          if (state.retiring && state.requests === 0) {
            retire(state)
          }
        })
        let result: HttpResolverResult
        try {
          emitter.emit('request:match', freezeLifecycleEvent({ ...event, handler }, request))
          const resolverContext: HttpResolverContext = {
            request: withRequestSignal((await loadRequest()).clone(), signal),
            params,
            cookies: { ...cookies },
            requestId: event.requestId,
            ...(context.context !== undefined ? { context: context.context } : {}),
            events: emitter.events,
            ...(scenario ? { scenario } : {}),
            finalize: scope.finalize,
          }
          if (handler.execution?.consumeOnce === 'execution') {
            state.used = true
          }
          result = await executeHandler(handler, state.runner, resolverContext, signal)
          if (handler.execution?.onceSequence === 'exhaustion' && state.runner.isSequence) {
            state.used = state.runner.exhausted
          }
          else if (result !== undefined && !isProtocolUnhandled(result)) {
            state.used = true
          }
          if (handler.once && state.used) {
            scope.finalize(state.runner.close)
          }
        }
        catch (error) {
          await scope.finish()
          throw error
        }
        finally {
          state.pending = undefined
          unlock?.()
        }
        if (isResponse(result)) {
          try {
            finishProtocolMisses()
            result = await normalizeBodylessResponse(result)
            if (request.method === 'HEAD' && result.body) {
              const cancellation = result.body.cancel()
              scope.finalize(() => cancellation)
              await cancellation
              signal.throwIfAborted()
              result = copyResponseCookies(result, new Response(null, { status: result.status, statusText: result.statusText, headers: result.headers }))
            }
            // A response clone would create an unconsumed tee branch and keep Node's
            // interceptor alive after close. The MSW facade supplies a metadata response
            // with the same status while the application receives the original stream.
            emitter.emit('response:mocked', freezeLifecycleEvent({
              ...event,
              handler,
              status: result.status,
              // Expose response metadata to lifecycle adapters without teeing the
              // application-owned body stream. The returned response remains the
              // only body owner.
              response: result.status === 0
                ? Response.error()
                : new Response(null, { status: result.status, statusText: result.statusText, headers: result.headers }),
            }, request))
            return await scope.observe(result)
          }
          catch (error) {
            await scope.finish()
            throw error
          }
        }
        await scope.finish()
        if (isProtocolUnhandled(result)) {
          protocolMisses.push(result)
          continue
        }
        if (result?.kind === 'mokup:passthrough') {
          finishProtocolMisses()
          emitter.emit('response:bypass', event)
          return undefined
        }
      }
      if (protocolMisses.length) {
        const misses = protocolMisses.splice(0)
        const groups = new Map<string, { selected: ProtocolUnhandledResult, misses: ProtocolUnhandledResult[] }>()
        for (const miss of misses) {
          const current = groups.get(miss.event.protocol)
          if (!current) {
            groups.set(miss.event.protocol, { selected: miss, misses: [miss] })
          }
          else {
            current.misses.push(miss)
            if (current.selected.policy === undefined && miss.policy !== undefined) {
              current.selected = miss
            }
          }
        }
        for (const group of groups.values()) {
          const { selected } = group
          emitter.emit('protocol:unhandled', { ...selected.event, reason: selected.reason })
          try {
            await withAbort(Promise.resolve().then(() => applyProtocolUnhandledPolicy(selected.policy, selected.event, {
              signal,
              request: async () => withRequestSignal((await loadRequest()).clone(), signal),
            })), signal)
          }
          catch (error) {
            emitter.emit('protocol:error', { ...selected.event, error })
            for (const miss of group.misses) {
              emitter.emit('protocol:end', miss.event)
            }
            throw error
          }
          for (const miss of group.misses) {
            emitter.emit('protocol:end', miss.event)
          }
        }
      }
      emitter.emit('request:unhandled', freezeLifecycleEvent({ ...event, decisionChain: Object.freeze(decisionChain.map(decision => Object.freeze(decision))) }, request))
      await withAbort(Promise.resolve().then(() => handleUnhandled(policy, event, {
        signal,
        request: async () => withRequestSignal((await loadRequest()).clone(), signal),
      })), signal)
      emitter.emit('response:bypass', freezeLifecycleEvent({ ...event }, request))
      return undefined
    }
    catch (error) {
      emitter.emit('unhandledException', freezeLifecycleEvent({ ...event, error }, request))
      throw error
    }
    finally {
      resolutionDone = true
      detach()
      emitter.emit('request:end', freezeLifecycleEvent({ ...event }, request))
    }
  }

  const session: MockSession = {
    signal: lifetime.signal,
    handle(request, context) {
      const task = resolve(request, context)
      tasks.add(task)
      void task.then(() => tasks.delete(task), () => tasks.delete(task))
      return task
    },
    use(...next) {
      assertActive()
      handlers = [...next, ...handlers]
    },
    removeHandlers(...removed) {
      const selected = new Set(removed)
      handlers = handlers.filter(handler => !selected.has(handler))
      for (const handler of removed) {
        const state = states.get(handler)
        if (state) {
          retire(state)
          states.delete(handler)
        }
      }
    },
    resetHandlers(...next) {
      assertActive()
      handlers = next.length ? [...next] : [...initial]
      for (const state of activeStates) {
        retire(state)
      }
      states = new WeakMap()
    },
    replaceInitialHandlers(...next) {
      assertActive()
      const previous = new Set(initial)
      const retained = new Set(next)
      handlers = [...handlers.filter(handler => !previous.has(handler)), ...next]
      for (const handler of initial) {
        if (!retained.has(handler)) {
          const state = states.get(handler)
          if (state) {
            retire(state, true)
            states.delete(handler)
          }
        }
      }
      initial = [...next]
    },
    restoreHandlers() {
      assertActive()
      for (const handler of handlers) {
        if (handler.once) {
          const state = states.get(handler)
          if (state) {
            retire(state, true)
            states.delete(handler)
          }
        }
      }
    },
    listHandlers: () => Object.freeze([...handlers]),
    setOnUnhandled(next) {
      assertActive()
      policy = next
    },
    ...(scenario ? { scenario } : {}),
    selectScenario(name) {
      assertActive()
      if (!scenario) {
        throw new Error('This mock session has no scenario catalog.')
      }
      scenario.select(name)
    },
    resetScenario() {
      assertActive()
      scenario?.reset()
    },
    fork() {
      assertActive()
      const forkOptions: MockSessionOptions = { handlers, onUnhandled: policy }
      if (scenario) {
        forkOptions.scenario = scenario.fork?.() ?? scenario
      }
      return buildSession(forkOptions, emitter, initial)
    },
    events: emitter.events,
    dispose() {
      if (!disposal) {
        const cleanups = [...resources]
        lifetime.abort(new DOMException('Mock session disposed.', 'AbortError'))
        for (const state of activeStates) {
          retire(state)
        }
        disposal = Promise.resolve().then(async () => {
          await Promise.allSettled(tasks)
          await Promise.allSettled(retiring)
          const results = await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)))
          const errors = [...retirementErrors, ...results.filter(result => result.status === 'rejected').map(result => result.reason)]
          if (errors.length) {
            throw new AggregateError(errors, 'HTTP mock session disposal failed.')
          }
        })
      }
      return disposal
    },
  }
  return session
}

export function createMockSession(...handlers: HttpHandler[]): MockSession
export function createMockSession(options: MockSessionOptions): MockSession
export function createMockSession(...input: HttpHandler[] | [MockSessionOptions]): MockSession {
  const first = input[0]
  const options = first && !('resolver' in first) ? first : { handlers: input as HttpHandler[] }
  return buildSession(options)
}
