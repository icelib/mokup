import { delay, http, HttpResponse, networkError } from '@mokup/runtime/http'
import { createScenario, createScenarioCatalog } from '@mokup/runtime/scenario'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupWorker } from '../src/browser'

interface Message {
  data: unknown
  ports: readonly MessagePort[]
  source: { id: string }
  waitUntil: (promise: Promise<unknown>) => void
}

interface FetchEvent {
  clientId: string
  request: Request
  respondWith: (response: Promise<Response>) => void
}

const origin = 'https://example.test'

describe('Service Worker protocol', () => {
  const workers: ReturnType<typeof setupWorker>[] = []

  afterEach(async () => {
    await Promise.all(workers.splice(0).map(worker => worker.stop()))
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function environment() {
    let message: (event: Message) => void = () => {}
    let intercepted: (event: FetchEvent) => void = () => {}
    const pending: Promise<unknown>[] = []
    const backend = vi.fn(async () => HttpResponse.text('real backend'))
    vi.stubGlobal('fetch', backend)
    vi.stubGlobal('location', new URL(`${origin}/`))
    const claim = vi.fn(async () => undefined)
    vi.stubGlobal('clients', { claim, get: async () => ({ id: 'page' }) })
    vi.stubGlobal('addEventListener', (type: string, listener: (event: never) => void) => {
      if (type === 'message') {
        message = listener as typeof message
      }
      if (type === 'fetch') {
        intercepted = listener as typeof intercepted
      }
    })
    await import('../src/network/mockServiceWorker')
    const serviceWorker = {
      scriptURL: `${origin}/mockServiceWorker.js`,
      state: 'activated',
      postMessage(data: unknown, ports: MessagePort[] = []) {
        message({ data, ports, source: { id: 'page' }, waitUntil: promise => pending.push(promise) })
      },
    }
    const registration = { scope: `${origin}/`, active: serviceWorker }
    const register = vi.fn(async () => registration)
    const getRegistration = vi.fn(async () => undefined as typeof registration | undefined)
    vi.stubGlobal('navigator', { serviceWorker: { register, getRegistration, controller: serviceWorker } })
    const fetch = (path: string, init?: RequestInit, clientId = 'page') => {
      let response: Promise<Response> | undefined
      intercepted({
        clientId,
        request: new Request(`${origin}${path}`, init),
        respondWith: (result) => { response = result },
      })
      return response ?? backend()
    }
    const setup = (...handlers: Parameters<typeof setupWorker>) => {
      const worker = setupWorker(...handlers)
      workers.push(worker)
      return worker
    }
    return { setup, fetch, register, getRegistration, claim, backend, pending, serviceWorker }
  }

  it('executes dynamic page handlers over MessagePorts without replacing fetch', async () => {
    const env = await environment()
    const worker = env.setup(http.post(`${origin}/api`, async ({ request }) => HttpResponse.json({
      body: await request.text(),
    }, { status: 201 })))
    await Promise.all([worker.start(), worker.start()])
    expect(worker.mode).toBe('serviceWorker')
    expect(globalThis.fetch).toBe(env.backend)
    expect(env.register).toHaveBeenCalledOnce()
    expect(env.register).toHaveBeenCalledWith(`${origin}/mockServiceWorker.js`, { type: 'module' })
    expect(env.claim).toHaveBeenCalledOnce()
    const response = await env.fetch('/api', { method: 'POST', body: 'body survives' })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ body: 'body survives' })
    worker.use(http.post(`${origin}/api`, () => HttpResponse.text('override')))
    expect(await (await env.fetch('/api', { method: 'POST' })).text()).toBe('override')
    worker.resetHandlers()
    expect(await (await env.fetch('/api', { method: 'POST', body: 'reset' })).json()).toEqual({ body: 'reset' })
    expect(await (await env.fetch('/missing')).text()).toBe('real backend')
    expect(await (await env.fetch('/api', { method: 'POST' }, 'another-page')).text()).toBe('real backend')
  })

  it('keeps scenario selection consistent across the Service Worker boundary and restarts', async () => {
    const env = await environment()
    const scenarios = createScenarioCatalog({
      happy: createScenario('happy', { status: 200 }),
      outage: createScenario('outage', { status: 503 }),
    })
    const worker = env.setup(
      http.get(`${origin}/scenario`, ({ scenario }) => HttpResponse.json({
        status: scenario?.current().getState(),
      })),
      { scenario: scenarios },
    )
    await worker.start()
    expect(await (await env.fetch('/scenario')).json()).toEqual({ status: { status: 200 } })
    worker.selectScenario('outage')
    expect(await (await env.fetch('/scenario')).json()).toEqual({ status: { status: 503 } })
    await worker.stop()
    await worker.start()
    expect(await (await env.fetch('/scenario')).json()).toEqual({ status: { status: 503 } })
    worker.resetScenario()
    expect(await (await env.fetch('/scenario')).json()).toEqual({ status: { status: 200 } })
  })

  it('streams chunks before completion and finalizes on consumer cancellation', async () => {
    const env = await environment()
    const cleanup = vi.fn()
    const worker = env.setup(http.get(`${origin}/stream`, ({ finalize }) => {
      finalize(cleanup)
      return new HttpResponse(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('first chunk')) },
      }))
    }))
    await worker.start()
    const response = await env.fetch('/stream')
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first chunk')
    await reader.cancel()
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce())
  })

  it('preserves caller request policies across the worker message boundary', async () => {
    const env = await environment()
    const worker = env.setup(http.get(`${origin}/policy`, ({ request }) => HttpResponse.json({
      mode: request.mode,
      cache: request.cache,
      credentials: request.credentials,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      integrity: request.integrity,
      keepalive: request.keepalive,
    })))
    await worker.start()
    const policy: RequestInit = {
      mode: 'same-origin',
      cache: 'only-if-cached',
      credentials: 'omit',
      redirect: 'manual',
      referrer: `${origin}/source`,
      referrerPolicy: 'same-origin',
      integrity: 'sha256-test',
      keepalive: true,
    }
    expect(await (await env.fetch('/policy', policy)).json()).toEqual(policy)
  })

  it('stops unread streams and pending handlers, then allows a fresh start', async () => {
    const env = await environment()
    const entered = Promise.withResolvers<void>()
    const cleanup = vi.fn()
    const worker = env.setup(
      http.get(`${origin}/unread`, ({ finalize }) => {
        finalize(cleanup)
        return new HttpResponse(new ReadableStream({ start() {} }))
      }),
      http.get(`${origin}/pending`, async ({ request }) => {
        entered.resolve()
        await delay('infinite', { signal: request.signal })
        return HttpResponse.text('never')
      }),
    )
    await worker.start()
    const unread = await env.fetch('/unread')
    const pending = env.fetch('/pending')
    await entered.promise
    await worker.stop()
    expect((await pending).type).toBe('error')
    await expect(unread.text()).rejects.toThrow()
    expect(cleanup).toHaveBeenCalledOnce()
    await worker.start()
    worker.use(http.get(`${origin}/pending`, () => HttpResponse.text('restarted')))
    expect(await (await env.fetch('/pending')).text()).toBe('restarted')
  })

  it('restores prior owners and transports network errors', async () => {
    const env = await environment()
    const first = env.setup(http.get(`${origin}/value`, () => HttpResponse.text('first')))
    const second = env.setup(http.get(`${origin}/value`, () => HttpResponse.text('second')), http.get(`${origin}/error`, () => networkError()))
    await first.start()
    await second.start()
    expect(await (await env.fetch('/value')).text()).toBe('second')
    expect((await env.fetch('/error')).type).toBe('error')
    await second.stop()
    expect(await (await env.fetch('/value')).text()).toBe('first')
    await first.stop()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await (await env.fetch('/value')).text()).toBe('real backend')
  })

  it('refuses to replace an unrelated Service Worker', async () => {
    const env = await environment()
    env.getRegistration.mockResolvedValue({ scope: `${origin}/`, active: {
      scriptURL: `${origin}/application-worker.js`,
      state: 'activated',
      postMessage() {},
    } })
    const worker = env.setup()
    await expect(worker.start()).rejects.toThrow('Another Service Worker controls this scope')
    expect(env.register).not.toHaveBeenCalled()
    expect(worker.readyState).toBe('stopped')
  })

  it('stops cleanly while the initial connection is pending', async () => {
    const env = await environment()
    const worker = env.setup(http.get(`${origin}/value`, () => HttpResponse.text('started')))
    await Promise.all([worker.start(), worker.stop()])
    expect(worker.readyState).toBe('stopped')
    await worker.start()
    expect(await (await env.fetch('/value')).text()).toBe('started')
  })

  it('cleans up failed handshakes and allows retry', async () => {
    const env = await environment()
    const post = vi.spyOn(env.serviceWorker, 'postMessage')
    post.mockImplementationOnce(() => {
      throw new Error('port transfer failed')
    })
    const worker = env.setup(http.get(`${origin}/value`, () => HttpResponse.text('retried')))
    await expect(worker.start()).rejects.toThrow('port transfer failed')
    expect(worker.readyState).toBe('stopped')
    await worker.start()
    expect(await (await env.fetch('/value')).text()).toBe('retried')
  })
})
