import type { Server } from 'node:http'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import { delay, http, HttpResponse, networkError, passthrough } from '@mokup/runtime/http'
import { JSDOM } from 'jsdom'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setupServer } from '../src/node'

function request(url: string, body = '') {
  return new Promise<{ status: number | undefined, body: string }>((resolve, reject) => {
    const req = httpRequest(url, { method: body ? 'POST' : 'GET' }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('error', reject)
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('Node network interception', () => {
  let backend: Server
  let origin: string
  const servers: ReturnType<typeof setupServer>[] = []
  const setup = (...handlers: Parameters<typeof setupServer>) => {
    const server = setupServer(...handlers)
    servers.push(server)
    return server
  }

  beforeAll(async () => {
    backend = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk))
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ source: 'network', body: Buffer.concat(chunks).toString() }))
    })
    backend.listen(0, '127.0.0.1')
    await once(backend, 'listening')
    const address = backend.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing HTTP test port')
    }
    origin = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.close()))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    backend.closeAllConnections()
    await new Promise<void>((resolve, reject) => backend.close(error => error ? reject(error) : resolve()))
  })

  it('mocks native fetch and ClientRequest while preserving the request body on passthrough', async () => {
    const server = setup(
      http.post(`${origin}/mock/:id`, async ({ request, params }) => HttpResponse.json({
        id: params['id'],
        body: await request.text(),
      }, { status: 201 })),
      http.post(`${origin}/read-then-pass`, async ({ request }) => {
        await request.text()
        return passthrough()
      }),
    )
    server.listen()
    const response = await fetch(`${origin}/mock/42`, { method: 'POST', body: 'fetch-body' })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: '42', body: 'fetch-body' })
    expect(await request(`${origin}/mock/17`, 'node-body')).toEqual({
      status: 201,
      body: JSON.stringify({ id: '17', body: 'node-body' }),
    })
    expect(await (await fetch(`${origin}/read-then-pass`, { method: 'POST', body: 'readable' })).json())
      .toEqual({ source: 'network', body: 'readable' })
    expect(JSON.parse((await request(`${origin}/real`, 'native')).body))
      .toEqual({ source: 'network', body: 'native' })
  })

  it('mocks Node XMLHttpRequest and parses multipart FormData through the same session', async () => {
    const dom = new JSDOM('', { url: `${origin}/` })
    vi.stubGlobal('XMLHttpRequest', dom.window.XMLHttpRequest)
    vi.stubGlobal('Document', dom.window.Document)
    vi.stubGlobal('XMLHttpRequestUpload', dom.window.XMLHttpRequestUpload)
    const server = setup(
      http.post(`${origin}/xhr`, async ({ request }) => HttpResponse.json({
        body: await request.text(),
      }, { status: 201, headers: { 'x-mokup-transport': 'xhr' } })),
      http.post(`${origin}/form`, async ({ request }) => {
        const form = await request.formData()
        return HttpResponse.json({
          name: form.get('name'),
          file: form.get('file') instanceof File
            ? {
                name: (form.get('file') as File).name,
                text: await (form.get('file') as File).text(),
              }
            : null,
        })
      }),
    )
    server.listen({ onUnhandled: 'error' })
    const xhr = await new Promise<{ status: number, header: string | null, body: string }>((resolve, reject) => {
      const request = new XMLHttpRequest()
      request.open('POST', `${origin}/xhr`)
      request.onload = () => resolve({ status: request.status, header: request.getResponseHeader('x-mokup-transport'), body: request.responseText })
      request.onerror = reject
      request.send('xhr-body')
    })
    expect(xhr).toEqual({ status: 201, header: 'xhr', body: JSON.stringify({ body: 'xhr-body' }) })

    const form = new FormData()
    form.set('name', 'mokup')
    form.set('file', new File(['fixture'], 'fixture.txt', { type: 'text/plain' }))
    expect(await (await fetch(`${origin}/form`, { method: 'POST', body: form })).json()).toEqual({
      name: 'mokup',
      file: { name: 'fixture.txt', text: 'fixture' },
    })
  })

  it('uses a shared event stream and errors unmatched requests without touching the backend', async () => {
    const server = setup(http.get(`${origin}/mock`, () => HttpResponse.text('mocked')))
    const started = vi.fn()
    const matched = vi.fn()
    server.events.on('request:start', started)
    server.events.on('response:mocked', matched)
    server.listen({ onUnhandled: 'error' })
    expect(await (await fetch(`${origin}/mock`)).text()).toBe('mocked')
    await expect(fetch(`${origin}/missing`)).rejects.toThrow('Unhandled request')
    expect(started).toHaveBeenCalledTimes(2)
    expect(matched).toHaveBeenCalledWith(expect.objectContaining({ status: 200, url: `${origin}/mock` }))
  })

  it('translates networkError to rejected fetch and ClientRequest error events', async () => {
    const server = setup(http.get(`${origin}/error`, () => networkError()))
    server.listen()
    await expect(fetch(`${origin}/error`)).rejects.toBeDefined()
    await expect(request(`${origin}/error`)).rejects.toBeDefined()
  })

  it('isolates parallel boundary overrides and once consumption', async () => {
    const initial = http.get(`${origin}/value`, () => HttpResponse.text('base'))
    const onceHandler = http.get(`${origin}/once`, () => HttpResponse.text('once'), { once: true })
    const server = setup(initial, onceHandler, http.get(`${origin}/once`, () => HttpResponse.text('fallback')))
    server.listen()
    const matched = vi.fn()
    server.events.on('request:match', matched)
    const run = server.boundary(async (value: string) => {
      server.use(http.get(`${origin}/value`, async () => {
        await delay(5)
        return HttpResponse.text(value)
      }))
      return Promise.all([
        fetch(`${origin}/value`).then(response => response.text()),
        fetch(`${origin}/once`).then(response => response.text()),
      ])
    })
    expect(await Promise.all([run('alpha'), run('beta')])).toEqual([['alpha', 'once'], ['beta', 'once']])
    expect(await (await fetch(`${origin}/value`)).text()).toBe('base')
    expect(await (await fetch(`${origin}/once`)).text()).toBe('once')
    expect(await (await fetch(`${origin}/once`)).text()).toBe('fallback')
    expect(matched).toHaveBeenCalledTimes(7)
    expect(server.listHandlers()).toEqual([initial, onceHandler, expect.any(Object)])
  })

  it('restarts idempotently and resets overrides to the original definitions', async () => {
    const nativeFetch = globalThis.fetch
    const server = setup(http.get(`${origin}/value`, () => HttpResponse.text('base')))
    server.listen()
    server.listen()
    server.use(http.get(`${origin}/value`, () => HttpResponse.text('override')))
    expect(await (await fetch(`${origin}/value`)).text()).toBe('override')
    await Promise.all([server.close(), server.close()])
    expect(globalThis.fetch).toBe(nativeFetch)
    expect(server.readyState).toBe('stopped')
    server.listen()
    expect(await (await fetch(`${origin}/value`)).text()).toBe('override')
    server.resetHandlers()
    expect(await (await fetch(`${origin}/value`)).text()).toBe('base')
  })

  it('does not remove interception owned by another active server', async () => {
    const first = setup(http.get(`${origin}/value`, () => HttpResponse.text('first')))
    const second = setup(http.get(`${origin}/value`, () => HttpResponse.text('second')))
    first.listen()
    second.listen()
    expect(await (await fetch(`${origin}/value`)).text()).toBe('second')
    await second.close()
    expect(await (await fetch(`${origin}/value`)).text()).toBe('first')
    await first.close()
    expect(await (await fetch(`${origin}/value`)).json()).toEqual({ source: 'network', body: '' })
  })

  it('aborts pending resolvers and awaits finalizers when closed', async () => {
    const entered = Promise.withResolvers<void>()
    const cleanup = vi.fn()
    const server = setup(http.get(`${origin}/pending`, async ({ request, finalize }) => {
      finalize(cleanup)
      entered.resolve()
      await delay('infinite', { signal: request.signal })
      return HttpResponse.text('never')
    }))
    server.listen()
    const result = fetch(`${origin}/pending`).catch(error => error)
    await entered.promise
    await server.close()
    expect(await result).toBeInstanceOf(Error)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(await (await fetch(`${origin}/pending`)).json()).toEqual({ source: 'network', body: '' })
  })

  it('preserves caller cancellation and releases resources', async () => {
    const entered = Promise.withResolvers<void>()
    const cleanup = vi.fn()
    const server = setup(http.get(`${origin}/pending`, async ({ request, finalize }) => {
      finalize(cleanup)
      entered.resolve()
      await delay('infinite', { signal: request.signal })
      return HttpResponse.text('never')
    }))
    server.listen()
    const controller = new AbortController()
    const result = fetch(`${origin}/pending`, { signal: controller.signal }).catch(error => error)
    await entered.promise
    controller.abort(new Error('cancelled by caller'))
    expect(await result).toMatchObject({ message: 'cancelled by caller' })
    await server.close()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('waits for every owned boundary cleanup before rejecting close with their failures', async () => {
    const nativeFetch = globalThis.fetch
    const entered = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const cleaning = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const release = Promise.withResolvers<void>()
    const failures = [new Error('first boundary cleanup'), new Error('second boundary cleanup')]
    const cleanupCalls: number[] = []
    const server = setupServer(http.get(`${origin}/cleanup/:index`, async ({ params, request, finalize }) => {
      const index = Number(params.index)
      finalize(async () => {
        cleanupCalls.push(index)
        cleaning[index]!.resolve()
        if (index === 1) {
          await release.promise
        }
        throw failures[index]
      })
      entered[index]!.resolve()
      await delay('infinite', { signal: request.signal })
      return HttpResponse.text('never')
    }))
    server.listen()
    const run = server.boundary(async (index: number) => fetch(`${origin}/cleanup/${index}`))
    const requests = [run(0).catch(error => error), run(1).catch(error => error)]
    try {
      await Promise.all(entered.map(gate => gate.promise))
      let settled = false
      const close = server.close()
      const closed = close.then(() => {
        settled = true
      }, (error: unknown) => {
        settled = true
        return error
      })
      expect(server.close()).toBe(close)
      expect(globalThis.fetch).toBe(nativeFetch)
      await Promise.all(cleaning.map(gate => gate.promise))
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(settled).toBe(false)
      release.resolve()
      const failure = await closed
      expect(failure).toBeInstanceOf(AggregateError)
      const causes = (error: unknown): unknown[] => error instanceof AggregateError ? error.errors.flatMap(causes) : [error]
      expect(new Set(causes(failure))).toEqual(new Set(failures))
      expect(cleanupCalls).toEqual([0, 1])
      expect(await Promise.all(requests)).toEqual([expect.any(AggregateError), expect.any(AggregateError)])
    }
    finally {
      release.resolve()
      await server.close().catch(() => undefined)
      await Promise.all(requests)
    }
  })

  it('preserves native ClientRequest cancellation', async () => {
    const entered = Promise.withResolvers<void>()
    const cleanup = vi.fn()
    const server = setup(http.get(`${origin}/pending`, async ({ request, finalize }) => {
      finalize(cleanup)
      entered.resolve()
      await delay('infinite', { signal: request.signal })
      return HttpResponse.text('never')
    }))
    server.listen()
    const controller = new AbortController()
    const result = new Promise<unknown>((resolve) => {
      const req = httpRequest(`${origin}/pending`, { signal: controller.signal })
      req.on('error', resolve)
      req.end()
    })
    await entered.promise
    controller.abort()
    expect(await result).toMatchObject({ code: 'ABORT_ERR' })
    await server.close()
    expect(cleanup).toHaveBeenCalledOnce()
  })
})
