import { delay, http, HttpResponse, networkError } from '@mokup/runtime/http'
import { createScenario, createScenarioCatalog } from '@mokup/runtime/scenario'
import { sse } from '@mokup/runtime/sse'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupWorker } from '../src/browser'

describe('browser interception fallback', () => {
  const workers: ReturnType<typeof setupWorker>[] = []
  const windows: JSDOM[] = []

  afterEach(async () => {
    await Promise.all(workers.splice(0).map(worker => worker.stop()))
    vi.unstubAllGlobals()
    for (const dom of windows.splice(0)) {
      dom.window.close()
    }
  })

  it('requires explicit fallback when Service Workers are unavailable', async () => {
    const worker = setupWorker()
    workers.push(worker)
    await expect(worker.start()).rejects.toThrow('Service Workers require a secure browser context')
    expect(worker.readyState).toBe('stopped')
  })

  it('identifies the in-page mode and intercepts native fetch without a Service Worker', async () => {
    const original = globalThis.fetch
    const worker = setupWorker(http.get('https://example.test/api', () => HttpResponse.json({ ok: true })))
    workers.push(worker)
    expect(worker.mode).toBe('serviceWorker')
    await Promise.all([worker.start({ mode: 'interceptor' }), worker.start({ mode: 'interceptor' })])
    expect(worker.mode).toBe('interceptor')
    expect(worker.readyState).toBe('started')
    expect(await (await fetch('https://example.test/api')).json()).toEqual({ ok: true })
    await Promise.all([worker.stop(), worker.stop()])
    expect(globalThis.fetch).toBe(original)
    await worker.start({ mode: 'interceptor' })
    expect(await (await fetch('https://example.test/api')).json()).toEqual({ ok: true })
  })

  it('exposes scenario controls for the interceptor fallback', async () => {
    const scenarios = createScenarioCatalog({
      happy: createScenario('happy', { status: 200 }),
      outage: createScenario('outage', { status: 503 }),
    })
    const worker = setupWorker(
      http.get('https://example.test/scenario', ({ scenario }) => HttpResponse.json(scenario?.current().getState())),
      { scenario: scenarios },
    )
    workers.push(worker)
    await worker.start({ mode: 'interceptor' })
    expect(await (await fetch('https://example.test/scenario')).json()).toEqual({ status: 200 })
    worker.selectScenario('outage')
    expect(await (await fetch('https://example.test/scenario')).json()).toEqual({ status: 503 })
    worker.resetScenario()
    expect(await (await fetch('https://example.test/scenario')).json()).toEqual({ status: 200 })
  })

  it('intercepts EventSource streams in interceptor mode and restores the native constructor', async () => {
    const NativeEventSource = class extends EventTarget {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 2
      readonly url: string
      readonly withCredentials: boolean
      readyState = 0
      constructor(url: string | URL, init: EventSourceInit = {}) {
        super()
        this.url = String(url)
        this.withCredentials = init.withCredentials === true
      }

      close() { this.readyState = 2 }
    } as unknown as typeof EventSource
    vi.stubGlobal('EventSource', NativeEventSource)
    const worker = setupWorker(
      sse('https://example.test/events', async function* () {
        yield { id: '1', data: { ok: true } }
        yield { event: 'update', data: 'done' }
      }),
    )
    workers.push(worker)
    await worker.start({ mode: 'interceptor' })
    const source = new EventSource('https://example.test/events')
    const messages: string[] = []
    const opened = Promise.withResolvers<void>()
    const received = Promise.withResolvers<void>()
    source.addEventListener('open', () => opened.resolve())
    source.addEventListener('message', (event) => {
      messages.push(`${event.type}:${(event as MessageEvent).data}:${(event as MessageEvent).lastEventId}`)
      if (messages.length === 1) {
        received.resolve()
      }
    })
    source.addEventListener('update', event => messages.push(`${event.type}:${(event as Event & { data?: string }).data}`))
    await opened.promise
    await received.promise
    await vi.waitFor(() => expect(messages).toEqual(['message:{"ok":true}:1', 'update:done']))
    source.close()
    await worker.stop()
    expect(globalThis.EventSource).toBe(NativeEventSource)
  })

  it('falls back to the native EventSource for bypassed requests', async () => {
    const opened = Promise.withResolvers<void>()
    const NativeEventSource = class extends EventTarget {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 2
      readonly url: string
      readonly withCredentials: boolean
      readyState = 0
      constructor(url: string | URL, init: EventSourceInit = {}) {
        super()
        this.url = String(url)
        this.withCredentials = init.withCredentials === true
        queueMicrotask(() => {
          this.readyState = 1
          this.dispatchEvent(new Event('open'))
          opened.resolve()
        })
      }

      close() { this.readyState = 2 }
    } as unknown as typeof EventSource
    vi.stubGlobal('EventSource', NativeEventSource)
    const worker = setupWorker(http.get('https://example.test/other', () => undefined))
    workers.push(worker)
    await worker.start({ mode: 'interceptor' })
    const source = new EventSource('https://example.test/other')
    const forwarded = Promise.withResolvers<void>()
    source.addEventListener('open', () => forwarded.resolve())
    await Promise.all([opened.promise, forwarded.promise])
    expect(source.readyState).toBe(1)
    await worker.stop()
    expect(globalThis.EventSource).toBe(NativeEventSource)
  })

  it('intercepts XMLHttpRequest with its response status, headers, and body', async () => {
    const dom = new JSDOM('', { url: 'https://example.test/' })
    windows.push(dom)
    vi.stubGlobal('XMLHttpRequest', dom.window.XMLHttpRequest)
    vi.stubGlobal('Document', dom.window.Document)
    vi.stubGlobal('XMLHttpRequestUpload', dom.window.XMLHttpRequestUpload)
    const worker = setupWorker(http.post('https://example.test/api', async ({ request }) => HttpResponse.json({
      body: await request.text(),
    }, { status: 201, headers: { 'x-mokup-test': 'xhr' } })))
    workers.push(worker)
    await worker.start({ mode: 'interceptor', onUnhandled: 'error' })
    const response = await new Promise<{ status: number, header: string | null, body: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', 'https://example.test/api')
      xhr.onload = () => resolve({ status: xhr.status, header: xhr.getResponseHeader('x-mokup-test'), body: xhr.responseText })
      xhr.onerror = reject
      xhr.send('xhr-body')
    })
    expect(response).toEqual({ status: 201, header: 'xhr', body: JSON.stringify({ body: 'xhr-body' }) })
  })

  it('settles caller aborts and response stream cancellation without orphaned tasks', async () => {
    const entered = Promise.withResolvers<void>()
    const cleanup = vi.fn()
    const worker = setupWorker(
      http.get('https://example.test/pending', async ({ request, finalize }) => {
        finalize(cleanup)
        entered.resolve()
        await delay('infinite', { signal: request.signal })
        return HttpResponse.text('never')
      }),
      http.get('https://example.test/stream', ({ finalize }) => {
        finalize(cleanup)
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode('first')) },
        }))
      }),
    )
    workers.push(worker)
    await worker.start({ mode: 'interceptor' })
    const controller = new AbortController()
    const pending = fetch('https://example.test/pending', { signal: controller.signal }).catch(error => error)
    await entered.promise
    controller.abort()
    expect(await pending).toMatchObject({ name: 'AbortError' })
    const stream = (await fetch('https://example.test/stream')).body!.getReader()
    expect(new TextDecoder().decode((await stream.read()).value)).toBe('first')
    await stream.cancel()
    await worker.stop()
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('delivers network errors through XHR even when the global Response constructor changes', async () => {
    const dom = new JSDOM('', { url: 'https://example.test/' })
    windows.push(dom)
    vi.stubGlobal('XMLHttpRequest', dom.window.XMLHttpRequest)
    vi.stubGlobal('Document', dom.window.Document)
    vi.stubGlobal('XMLHttpRequestUpload', dom.window.XMLHttpRequestUpload)
    const NativeResponse = globalThis.Response
    vi.stubGlobal('Response', class AdapterResponse extends NativeResponse {})
    const worker = setupWorker(http.get('https://example.test/error', () => networkError()))
    workers.push(worker)
    await worker.start({ mode: 'interceptor', onUnhandled: 'error' })
    const result = await new Promise<{ type: string, status: number }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', 'https://example.test/error')
      xhr.onload = () => reject(new Error('A network error must not emit load'))
      xhr.onerror = event => resolve({ type: event.type, status: xhr.status })
      xhr.send()
    })
    expect(result).toEqual({ type: 'error', status: 0 })
  })
})
