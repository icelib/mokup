import { createFetchAdapter } from '@mokup/client'
import { describe, expect, it, vi } from 'vitest'
import { createFetchExecutor, createMokupQueryClient, MokupHttpError } from '../src/index'

const request = { url: 'https://api.example.test/users' }

describe('Fetch executor response handling', () => {
  it.each([
    [404, 'Not Found', 'text/plain', 'No matching user'],
    [503, 'Service Unavailable', 'application/json', '{"error":"unavailable"}'],
    [500, 'Internal Server Error', 'application/json', 'not valid JSON'],
  ])('rejects HTTP %s before consuming or parsing its body', async (status, statusText, contentType, body) => {
    const response = new Response(body, { status, statusText, headers: { 'content-type': contentType } })
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response)
    const executor = createFetchExecutor({ fetch })

    const error: unknown = await executor(request).catch(error => error)

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(MokupHttpError)
    expect(error).toMatchObject({ name: 'MokupHttpError', status, statusText, response })
    expect((error as Error).message).toContain(String(status))
    expect((error as MokupHttpError).response).toBe(response)
    expect(response.bodyUsed).toBe(false)
    expect(await (error as MokupHttpError).response.text()).toBe(body)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['HEAD', 404],
    ['GET', 304],
  ] as const)('rejects bodyless %s HTTP %s responses before applying empty-body handling', async (method, status) => {
    const response = new Response(null, { status, headers: { 'content-type': 'application/json' } })
    const executor = createFetchExecutor({ fetch: async () => response })

    const error: unknown = await executor({ ...request, method }).catch(error => error)

    expect(error).toBeInstanceOf(MokupHttpError)
    expect((error as MokupHttpError).response).toBe(response)
    expect((error as MokupHttpError).status).toBe(status)
    expect(response.bodyUsed).toBe(false)
  })

  it.each([
    ['application/json; charset=utf-8', '{"ok":true}', { ok: true }],
    ['text/plain', 'ready', 'ready'],
  ])('keeps successful %s response parsing', async (contentType, body, expected) => {
    const executor = createFetchExecutor({
      fetch: async () => new Response(body, { headers: { 'content-type': contentType } }),
    })

    expect(await executor(request)).toEqual(expected)
  })

  it.each([
    ['HEAD', 200],
    ['head', 200],
    ['DELETE', 204],
    ['POST', 205],
  ] as const)('resolves successful %s HTTP %s responses without parsing advertised JSON', async (method, status) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }))
    const executor = createFetchExecutor({ fetch })

    expect(await executor({ ...request, method })).toBe('')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[1]?.method).toBe(method.toUpperCase())
  })

  it('preserves JSON parse errors for successful responses', async () => {
    const executor = createFetchExecutor({
      fetch: async () => new Response('not JSON', { headers: { 'content-type': 'application/json' } }),
    })

    await expect(executor(request)).rejects.toBeInstanceOf(SyntaxError)
  })

  it.each([null, ''])('preserves JSON parse errors for an ordinary GET with empty body %s', async (body) => {
    const executor = createFetchExecutor({
      fetch: async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
    })

    await expect(executor(request)).rejects.toBeInstanceOf(SyntaxError)
  })

  it('preserves a network rejection instead of wrapping it as an HTTP error', async () => {
    const failure = new TypeError('Network unavailable')
    const executor = createFetchExecutor({
      fetch: async () => {
        throw failure
      },
    })

    await expect(executor(request)).rejects.toBe(failure)
  })

  it('forwards query cancellation and preserves its rejection reason', async () => {
    const controller = new AbortController()
    const reason = new DOMException('Cancelled by caller', 'AbortError')
    controller.abort(reason)
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      init?.signal?.throwIfAborted()
      return new Response('unexpected')
    })
    const { queryFn } = createMokupQueryClient({ fetch })

    await expect(queryFn({ queryKey: [request.url], signal: controller.signal })).rejects.toBe(reason)
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
  })

  it.each(['query', 'mutation'])('propagates HTTP errors through the default %s function', async (operation) => {
    const response = Response.json({ error: 'unavailable' }, { status: 503 })
    const client = createMokupQueryClient({ fetch: async () => response })
    const result = operation === 'query'
      ? client.queryFn({ queryKey: [request.url] })
      : client.mutationFn(['POST', request.url, { body: { name: 'Ada' } }])

    await expect(result).rejects.toMatchObject({ name: 'MokupHttpError', status: 503, response })
    expect(response.bodyUsed).toBe(false)
  })

  it.each([
    ['query', 'HEAD', 200],
    ['mutation', 'DELETE', 204],
    ['mutation', 'POST', 205],
  ] as const)('returns empty data through the default %s function for %s HTTP %s', async (operation, method, status) => {
    const client = createMokupQueryClient({
      fetch: async () => new Response(null, { status, headers: { 'content-type': 'application/json' } }),
    })
    const result = operation === 'query'
      ? client.queryFn({ queryKey: [method, request.url] })
      : client.mutationFn([method, request.url])

    await expect(result).resolves.toBe('')
  })

  it.each(['query', 'mutation'])('uses the final method override to parse a %s response', async (operation) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => init?.method === 'HEAD'
      ? new Response(null, { headers: { 'content-type': 'application/json' } })
      : Response.json({ ok: true }))
    const client = createMokupQueryClient({ fetch })
    const execute = (method: string, override: string) => operation === 'query'
      ? client.queryFn({ queryKey: [method, request.url, { method: override }] })
      : client.mutationFn([method, request.url, { method: override }])

    expect(await execute('GET', 'head')).toBe('')
    expect(await execute('HEAD', 'get')).toEqual({ ok: true })
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(['HEAD', 'GET'])
  })

  it.each([200, 404, 503])('lets a custom transform own HTTP %s handling and parsing', async (status) => {
    const response = new Response('custom payload', { status })
    const transformResponse = vi.fn(async (value: Response) => ({ status: value.status, body: await value.text() }))
    const executor = createFetchExecutor({ fetch: async () => response, transformResponse })

    expect(await executor(request)).toEqual({ status, body: 'custom payload' })
    expect(transformResponse).toHaveBeenCalledExactlyOnceWith(response)
  })

  it('lets a custom transform return an unread Response', async () => {
    const response = new Response('inspect later', { status: 404 })
    const executor = createFetchExecutor({ fetch: async () => response, transformResponse: async value => value })

    expect(await executor(request)).toBe(response)
    expect(response.bodyUsed).toBe(false)
  })

  it.each([
    ['HEAD', 200],
    ['DELETE', 204],
    ['POST', 205],
  ] as const)('passes the original %s HTTP %s response as the sole custom transform argument', async (method, status) => {
    const response = new Response(null, { status, headers: { 'content-type': 'application/json' } })
    const transformResponse = vi.fn(async (value: Response) => value)
    const executor = createFetchExecutor({ fetch: async () => response, transformResponse })

    expect(await executor({ ...request, method })).toBe(response)
    expect(transformResponse).toHaveBeenCalledExactlyOnceWith(response)
    expect(response.bodyUsed).toBe(false)
  })

  it('preserves a custom transform rejection for a successful bodyless response', async () => {
    const response = new Response(null, { status: 204, headers: { 'content-type': 'application/json' } })
    const failure = new Error('Application requires a response payload')
    const transformResponse = vi.fn(async () => {
      throw failure
    })
    const executor = createFetchExecutor({ fetch: async () => response, transformResponse })

    await expect(executor({ ...request, method: 'DELETE' })).rejects.toBe(failure)
    expect(transformResponse).toHaveBeenCalledExactlyOnceWith(response)
  })

  it('preserves a rejection chosen by a custom transform', async () => {
    const failure = new Error('Application policy rejected this response')
    const transformResponse = vi.fn(async () => {
      throw failure
    })
    const executor = createFetchExecutor({
      fetch: async () => new Response('failed', { status: 503 }),
      transformResponse,
    })

    await expect(executor(request)).rejects.toBe(failure)
    expect(transformResponse).toHaveBeenCalledTimes(1)
  })

  it('forwards the query client custom transform to its default executor', async () => {
    const transformResponse = vi.fn(async (response: Response) => `fallback:${response.status}`)
    const client = createMokupQueryClient({
      fetch: async () => new Response('failed', { status: 503 }),
      transformResponse,
    })

    expect(await client.queryFn({ queryKey: [request.url] })).toBe('fallback:503')
    expect(await client.mutationFn(['POST', request.url])).toBe('fallback:503')
    expect(transformResponse).toHaveBeenCalledTimes(2)
  })

  it('keeps the raw client Fetch adapter HTTP semantics unchanged', async () => {
    const response = new Response('unavailable', { status: 503 })
    const adapter = createFetchAdapter({ fetch: async () => response })

    expect(await adapter(request.url)).toBe(response)
    expect(response.bodyUsed).toBe(false)
  })
})
