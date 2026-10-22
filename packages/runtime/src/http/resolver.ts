import type { HttpExecutionOptions, HttpResolver, HttpResolverContext, HttpResolverIterable, HttpResolverResult, HttpResolverReturn } from './types'
import { isResponse } from './is-response'
import { withRequestSignal } from './request'
import { createRequestResources, withAbort } from './resources'
import { createResponseReplay } from './response-replay'

type ResponseIterator = Iterator<HttpResolverResult | Promise<HttpResolverResult>> | AsyncIterator<HttpResolverResult>

function iteratorOf(value: HttpResolverReturn): ResponseIterator | undefined {
  if (!value || typeof value !== 'object' || isResponse(value)) {
    return undefined
  }
  if (Symbol.asyncIterator in value) {
    return (value as AsyncIterable<HttpResolverResult>)[Symbol.asyncIterator]()
  }
  if (Symbol.iterator in value) {
    return (value as Iterable<HttpResolverResult | Promise<HttpResolverResult>>)[Symbol.iterator]()
  }
  return undefined
}

/** Map a sequence without discarding its return value or return() cleanup. */
export async function* mapResolverSequence(sequence: HttpResolverIterable, map: (value: HttpResolverResult) => Promise<HttpResolverResult>): AsyncGenerator<HttpResolverResult, HttpResolverResult> {
  const iterator = iteratorOf(sequence)!
  try {
    while (true) {
      const next = await iterator.next()
      const result = await map(await next.value)
      if (next.done) {
        return result
      }
      yield result
    }
  }
  finally {
    await iterator.return?.()
  }
}

export function isResolverSequence(value: HttpResolverReturn): value is HttpResolverIterable {
  return Boolean(value && typeof value === 'object' && !isResponse(value) && (Symbol.iterator in value || Symbol.asyncIterator in value))
}

function createExecution(context: HttpResolverContext, lifetime: AbortSignal, onFinish: () => void) {
  const controller = new AbortController()
  const abortRequest = () => controller.abort(context.request.signal.reason)
  const abortSession = () => controller.abort(lifetime.reason)
  context.request.signal.addEventListener('abort', abortRequest, { once: true })
  lifetime.addEventListener('abort', abortSession, { once: true })
  if (context.request.signal.aborted) {
    abortRequest()
  }
  if (lifetime.aborted) {
    abortSession()
  }
  let persistent = false
  // Resolver cancellation and finalization are separate: iterator.return() must
  // get a chance to run its finally block before iterator finalizers settle.
  const finalizers = createRequestResources(new AbortController().signal, () => {
    context.request.signal.removeEventListener('abort', abortRequest)
    lifetime.removeEventListener('abort', abortSession)
    onFinish()
  })
  context.finalize(() => persistent ? undefined : finalizers.finish())
  return {
    signal: controller.signal,
    context: { ...context, request: withRequestSignal(context.request, controller.signal), finalize: finalizers.finalize },
    finish: finalizers.finish,
    abort: (reason: unknown) => controller.abort(reason),
    persist() {
      persistent = true
      context.request.signal.removeEventListener('abort', abortRequest)
    },
  }
}

/** Mutable sequence state lives in a session, never in a reusable handler definition. */
export function createResolverRunner(lifetime: AbortSignal, options: HttpExecutionOptions = {}) {
  type Execution = ReturnType<typeof createExecution>
  const executions = new Set<Execution>()
  let iterator: ResponseIterator | undefined
  let iteratorExecution: Execution | undefined
  let activeResponses = 0
  let mode: 'unknown' | 'direct' | 'sequence' | 'done' = 'unknown'
  let pending: Promise<void> | undefined
  let closed: Promise<void> | undefined
  let lastResult: HttpResolverResult
  let replay: ReturnType<typeof createResponseReplay> | undefined
  const replays = new Set<ReturnType<typeof createResponseReplay>>()

  const remember = (value: HttpResolverResult) => {
    if (value === undefined || options.sequence !== 'repeat-last') {
      return value
    }
    replay?.retire()
    replay = undefined
    lastResult = value
    if (isResponse(value)) {
      const snapshot = createResponseReplay(value, () => replays.delete(snapshot))
      replays.add(snapshot)
      replay = snapshot
      return snapshot.take()
    }
    return value
  }
  const repeat = () => replay ? replay.take() : lastResult

  const close = (): Promise<void> => {
    if (!closed) {
      const reason = new DOMException('HTTP resolver sequence closed.', 'AbortError')
      for (const execution of executions) {
        execution.abort(reason)
      }
      closed = Promise.resolve().then(async () => {
        const errors: unknown[] = []
        try {
          await iterator?.return?.()
        }
        catch (error) {
          errors.push(error)
        }
        mode = 'done'
        const results = await Promise.allSettled([
          ...[...replays].map(snapshot => snapshot.close()),
          ...[...executions].map(execution => execution.finish()),
        ])
        errors.push(...results.filter(result => result.status === 'rejected').map(result => result.reason))
        if (errors.length) {
          throw new AggregateError(errors, 'HTTP resolver cleanup failed.')
        }
      })
    }
    return closed
  }

  const next = async (signal: AbortSignal, finalize: HttpResolverContext['finalize']): Promise<HttpResolverResult> => {
    const execution = iteratorExecution!
    const abort = () => execution.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
    }
    try {
      const result = await withAbort(Promise.resolve().then(() => iterator!.next()).catch((error: unknown) => {
        if (isResponse(error)) {
          return { done: true, value: error }
        }
        throw error
      }), execution.signal)
      const nextValue = await withAbort(Promise.resolve(result.value), execution.signal)
      const value = nextValue === undefined && result.done && options.sequence === 'repeat-last'
        ? repeat()
        : remember(nextValue)
      if (isResponse(value)) {
        activeResponses++
        finalize(async () => {
          activeResponses--
          if (mode === 'done' && activeResponses === 0) {
            await execution.finish()
          }
        })
      }
      if (result.done) {
        mode = 'done'
        // The final response and previous yielded streams may still be live.
        // Natural completion keeps their resources until every body settles.
        if (activeResponses === 0) {
          await execution.finish()
        }
      }
      return value
    }
    catch (error) {
      await close()
      throw error
    }
    finally {
      signal.removeEventListener('abort', abort)
    }
  }

  const advance = async (signal: AbortSignal, finalize: HttpResolverContext['finalize']): Promise<HttpResolverResult> => {
    while (true) {
      const active = pending
      if (!active) {
        break
      }
      await withAbort(active, signal)
    }
    if (closed || mode === 'done') {
      return closed || options.sequence !== 'repeat-last' ? undefined : repeat()
    }
    let unlock!: () => void
    pending = new Promise<void>((resolve) => {
      unlock = resolve
    })
    try {
      return await next(signal, finalize)
    }
    finally {
      pending = undefined
      unlock()
    }
  }

  const invoke = async (resolver: HttpResolver, context: HttpResolverContext, signal: AbortSignal): Promise<HttpResolverResult> => {
    const execution = createExecution(context, lifetime, () => executions.delete(execution))
    executions.add(execution)
    const resultPromise = Promise.resolve().then(() => resolver(execution.context)).catch((error: unknown) => {
      if (isResponse(error)) {
        return error
      }
      throw error
    })
    // A cooperative resolver stops on abort. Still release late returned resources
    // when a resolver ignores cancellation and eventually produces a response.
    void resultPromise.then(async (result) => {
      if (execution.signal.aborted) {
        if (isResponse(result)) {
          await result.body?.cancel(execution.signal.reason)
        }
        else {
          await iteratorOf(result)?.return?.()
        }
      }
    }).catch(() => undefined)
    const result = await withAbort(resultPromise, execution.signal)
    const sequence = iteratorOf(result)
    if (sequence) {
      if (mode === 'direct') {
        await sequence.return?.()
        await execution.finish()
        throw new TypeError('A resolver must consistently return a response or a single response sequence.')
      }
      if (iterator) {
        // Concurrent initial invocations can discover a sequence together.
        // One session owns one iterator; discard the redundant execution.
        await sequence.return?.()
        await execution.finish()
      }
      else {
        iterator = sequence
        iteratorExecution = execution
        mode = 'sequence'
        execution.persist()
      }
      return await advance(signal, context.finalize)
    }
    if (iterator) {
      await execution.finish()
      throw new TypeError('A resolver must consistently return a response or a single response sequence.')
    }
    mode = 'direct'
    return result as HttpResolverResult
  }

  return {
    close,
    get isSequence() { return iterator !== undefined },
    get exhausted() { return mode === 'done' },
    async resolve(resolver: HttpResolver, context: HttpResolverContext, signal: AbortSignal): Promise<HttpResolverResult> {
      if (closed || mode === 'done') {
        return closed || options.sequence !== 'repeat-last' ? undefined : repeat()
      }
      // Ordinary asynchronous handlers must be concurrent from their first call.
      // Only advancing a shared iterator requires serialization.
      return mode === 'sequence' ? await advance(signal, context.finalize) : await invoke(resolver, context, signal)
    },
  }
}
