import type { HttpEvents, HttpHandlerOptions, HttpMatcher, HttpResolverContext, ProtocolEvent, ProtocolUnhandledPolicy } from './http'
import { http } from './http'
import { protocolUnhandled } from './protocol-policy'

export interface SseEvent {
  data?: string | unknown
  event?: string
  id?: string
  retry?: number
  comment?: string
}

export interface SseOptions extends HttpHandlerOptions {
  events?: Pick<HttpEvents, 'emit'>
  onUnhandled?: ProtocolUnhandledPolicy
}

const encoder = new TextEncoder()
function encodeEvent(event: SseEvent): Uint8Array {
  const lines: string[] = []
  for (const key of ['event', 'id'] as const) {
    const value = event[key]
    if (value !== undefined) {
      if (/[\r\n\0]/.test(value)) {
        throw new TypeError(`SSE ${key} cannot contain newlines or NUL.`)
      }
      lines.push(`${key}: ${value}`)
    }
  }
  if (event.retry !== undefined) {
    if (!Number.isSafeInteger(event.retry) || event.retry < 0) {
      throw new TypeError('SSE retry must be a non-negative integer.')
    }
    lines.push(`retry: ${event.retry}`)
  }
  if (event.comment !== undefined) {
    lines.push(...event.comment.split(/\r\n|\r|\n/).map(line => `: ${line}`))
  }
  if (event.data !== undefined) {
    const data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data)
    if (data === undefined) {
      throw new TypeError('SSE data must be serializable.')
    }
    lines.push(...data.split(/\r\n|\r|\n/).map(line => `data: ${line}`))
  }
  return encoder.encode(`${lines.join('\n')}\n\n`)
}

/** Pull-based streaming: one event at a time, with iterator cleanup on cancellation. */
export function eventStream(events: AsyncIterable<SseEvent> | Iterable<SseEvent>, init: ResponseInit = {}, signal?: AbortSignal): Response {
  const iterator = Symbol.asyncIterator in events ? events[Symbol.asyncIterator]() : events[Symbol.iterator]()
  let done = false
  let controller: ReadableStreamDefaultController<Uint8Array>
  let abort: () => void
  const close = async () => {
    if (done) {
      return
    }
    done = true
    signal?.removeEventListener('abort', abort)
    await iterator.return?.()
  }
  abort = () => {
    if (!done) {
      controller.error(signal?.reason)
      void close().catch(() => undefined)
    }
  }
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
      }
    },
    async pull(value) {
      if (done) {
        return
      }
      try {
        const next = await iterator.next()
        if (done) {
          return
        }
        if (next.done) {
          await close()
          value.close()
        }
        else {
          value.enqueue(encodeEvent(next.value))
        }
      }
      catch (error) {
        value.error(error)
        await close()
      }
    },
    cancel: close,
  })
  const headers = new Headers(init.headers)
  headers.set('content-type', 'text/event-stream')
  headers.set('cache-control', 'no-cache')
  return new Response(stream, { ...init, headers })
}

export function sse(
  matcher: HttpMatcher,
  resolver: (context: HttpResolverContext) => AsyncIterable<SseEvent> | Iterable<SseEvent> | undefined | Promise<AsyncIterable<SseEvent> | Iterable<SseEvent> | undefined>,
  options?: SseOptions,
) {
  const handlerOptions: HttpHandlerOptions | undefined = options?.once === undefined ? undefined : { once: options.once }
  return http.get(matcher, async (context) => {
    const events = options?.events ?? context.events
    const baseEvent: ProtocolEvent = {
      requestId: context.requestId,
      method: context.request.method,
      url: context.request.url,
      protocol: 'sse' as const,
      connectionId: context.requestId,
    }
    events?.emit('protocol:start', baseEvent)
    let source: AsyncIterable<SseEvent> | Iterable<SseEvent> | undefined
    try {
      source = await resolver(context)
      if (source === undefined) {
        return protocolUnhandled(baseEvent, 'No SSE stream matched this request.', options?.onUnhandled)
      }
      events?.emit('protocol:match', baseEvent)
    }
    catch (error) {
      events?.emit('protocol:error', { ...baseEvent, error })
      events?.emit('protocol:end', baseEvent)
      throw error
    }
    const stream = source!
    async function* instrumented() {
      try {
        for await (const value of stream) {
          events?.emit('protocol:message', { ...baseEvent, direction: 'outbound', data: value })
          yield value
        }
      }
      catch (error) {
        events?.emit('protocol:error', { ...baseEvent, error })
        throw error
      }
      finally {
        events?.emit('protocol:end', baseEvent)
      }
    }
    return eventStream(instrumented(), {}, context.request.signal)
  }, handlerOptions)
}
