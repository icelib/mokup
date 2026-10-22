import type { MockSession } from '@mokup/runtime/http'

interface NativeEventSourceLike {
  close: () => void
  addEventListener: (type: string, listener: EventListener) => void
}

type NativeEventSourceConstructor = new (url: string | URL, init?: EventSourceInit) => NativeEventSourceLike

interface ParsedEvent {
  type: string
  data: string
  id: string
}

function parseEventBlock(block: string, lastEventId: string): ParsedEvent | undefined {
  let type = 'message'
  let id = lastEventId
  const data: string[] = []
  for (const line of block.split(/\r?\n/gu)) {
    if (!line || line.startsWith(':')) {
      continue
    }
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /u, '')
    if (field === 'event') {
      type = value || 'message'
    }
    else if (field === 'data') {
      data.push(value)
    }
    else if (field === 'id' && !value.includes('\0')) {
      id = value
    }
  }
  if (!data.length) {
    return undefined
  }
  return { type, data: data.join('\n'), id }
}

function eventFor(type: string, init: EventInit & { data?: string, lastEventId?: string, origin?: string, error?: unknown } = {}) {
  if (type === 'message' && typeof globalThis.MessageEvent === 'function') {
    return new MessageEvent(type, init)
  }
  const event = new Event(type, init)
  Object.defineProperties(event, {
    data: { configurable: true, value: init.data ?? '' },
    lastEventId: { configurable: true, value: init.lastEventId ?? '' },
    origin: { configurable: true, value: init.origin ?? '' },
  })
  return event
}

function emit(target: EventTarget, event: Event, callback: ((event: Event) => unknown) | null) {
  target.dispatchEvent(event)
  callback?.(event)
}

/** Install a browser EventSource facade for in-page Fetch/XHR interception. */
export function attachEventSource(session: () => MockSession): () => Promise<void> {
  const Native = globalThis.EventSource as unknown as NativeEventSourceConstructor | undefined
  if (typeof Native !== 'function' || typeof globalThis.EventTarget !== 'function') {
    return async () => undefined
  }
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
  if (descriptor && !descriptor.configurable && !descriptor.writable) {
    throw new Error('[mokup] The global EventSource constructor cannot be patched.')
  }
  const NativeConstructor = Native
  const owned = new Set<{ close: () => void }>()

  class MockEventSource extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSED = 2

    readonly url: string
    readonly withCredentials: boolean
    readyState = MockEventSource.CONNECTING
    onopen: ((event: Event) => unknown) | null = null
    onmessage: ((event: Event) => unknown) | null = null
    onerror: ((event: Event) => unknown) | null = null
    #controller: AbortController | undefined
    #reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    #fallback: NativeEventSourceLike | undefined
    #closed = false
    #lastEventId = ''

    constructor(input: string | URL, init: EventSourceInit = {}) {
      super()
      this.url = new URL(String(input), globalThis.location?.href ?? 'http://mokup.invalid/').href
      this.withCredentials = init.withCredentials === true
      owned.add(this)
      void this.#connect()
    }

    close() {
      if (this.#closed) {
        return
      }
      this.#closed = true
      this.readyState = MockEventSource.CLOSED
      const reader = this.#reader
      this.#reader = undefined
      const cancellation = reader?.cancel().catch(() => undefined)
      if (cancellation) {
        void cancellation.finally(() => this.#controller?.abort(new DOMException('EventSource closed.', 'AbortError')))
      }
      else {
        this.#controller?.abort(new DOMException('EventSource closed.', 'AbortError'))
      }
      this.#fallback?.close()
      owned.delete(this)
    }

    async #connect() {
      const controller = new AbortController()
      this.#controller = controller
      try {
        const request = new Request(this.url, {
          method: 'GET',
          headers: { accept: 'text/event-stream' },
          credentials: this.withCredentials ? 'include' : 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        })
        const response = await session().handle(request)
        if (this.#closed) {
          await response?.body?.cancel()
          return
        }
        if (!response) {
          this.#connectFallback()
          return
        }
        if (response.type === 'error' || !response.body) {
          throw new Error(`EventSource mock returned an unusable response (${response.status}).`)
        }
        this.readyState = MockEventSource.OPEN
        emit(this, new Event('open'), this.onopen)
        await this.#read(response.body)
      }
      catch (error) {
        if (!this.#closed && !(error instanceof DOMException && error.name === 'AbortError')) {
          const event = eventFor('error', { error })
          emit(this, event, this.onerror)
          this.close()
        }
      }
    }

    #connectFallback() {
      try {
        const fallback = new NativeConstructor(this.url, { withCredentials: this.withCredentials })
        this.#fallback = fallback
        const forward = (type: string) => (event: Event) => {
          if (this.#closed) {
            return
          }
          if (type === 'open') {
            this.readyState = MockEventSource.OPEN
          }
          const forwarded = type === 'message'
            ? eventFor('message', {
                data: (event as MessageEvent).data,
                lastEventId: (event as MessageEvent).lastEventId,
                origin: (event as MessageEvent).origin,
              })
            : new Event(type)
          emit(this, forwarded, type === 'open' ? this.onopen : type === 'message' ? this.onmessage : this.onerror)
        }
        fallback.addEventListener('open', forward('open'))
        fallback.addEventListener('message', forward('message'))
        fallback.addEventListener('error', forward('error'))
      }
      catch (error) {
        const event = eventFor('error', { error })
        emit(this, event, this.onerror)
        this.close()
      }
    }

    async #read(body: ReadableStream<Uint8Array>) {
      this.#reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!this.#closed) {
        const next = await this.#reader.read()
        if (next.done) {
          buffer += decoder.decode()
          if (buffer.trim()) {
            this.#dispatchBlock(buffer)
          }
          this.close()
          return
        }
        buffer += decoder.decode(next.value, { stream: true })
        let boundary = buffer.search(/\r?\n\r?\n/u)
        while (boundary !== -1) {
          const match = buffer.slice(0, boundary)
          const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/u)?.[0].length ?? 2
          buffer = buffer.slice(boundary + separator)
          this.#dispatchBlock(match)
          boundary = buffer.search(/\r?\n\r?\n/u)
        }
      }
    }

    #dispatchBlock(block: string) {
      const parsed = parseEventBlock(block, this.#lastEventId)
      if (!parsed || this.#closed) {
        return
      }
      this.#lastEventId = parsed.id
      const event = eventFor(parsed.type, {
        data: parsed.data,
        lastEventId: parsed.id,
        origin: new URL(this.url).origin,
      })
      emit(this, event, parsed.type === 'message' ? this.onmessage : null)
    }
  }

  Object.defineProperty(globalThis, 'EventSource', {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? true,
    writable: true,
    value: MockEventSource,
  })

  return async () => {
    for (const source of [...owned]) {
      source.close()
    }
    if (descriptor) {
      Object.defineProperty(globalThis, 'EventSource', descriptor)
    }
    else {
      delete (globalThis as { EventSource?: unknown }).EventSource
    }
  }
}
