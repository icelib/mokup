import type { RequestExecutor } from '../src/index'
import { runInNewContext } from 'node:vm'
import { createMockResolver } from '@mokup/client'
import { describe, expect, it, vi } from 'vitest'
import { createFetchExecutor, createMokupQueryClient } from '../src/index'

function createInspectingFetch() {
  return vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const request = new Request(input, init)
    return Response.json({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: await request.text(),
    })
  })
}

describe('Fetch executor JSON request bodies', () => {
  it.each([
    ['object', () => ({ name: 'Ada', active: true }), '{"name":"Ada","active":true}'],
    ['empty object', () => ({}), '{}'],
    ['null prototype', () => Object.assign(Object.create(null), { name: 'Ada' }), '{"name":"Ada"}'],
    ['cross-realm object', () => runInNewContext('({ name: "Ada" })'), '{"name":"Ada"}'],
    ['array', () => [1, true, null], '[1,true,null]'],
    ['object array', () => [{ name: 'Ada' }], '[{"name":"Ada"}]'],
    ['empty array', () => [], '[]'],
    ['cross-realm array', () => runInNewContext('[1, 2]'), '[1,2]'],
  ] as const)('encodes a %s as a JSON wire payload', async (_label, createBody, expected) => {
    const body = createBody()
    const fetch = createInspectingFetch()
    const executor = createFetchExecutor({ fetch })

    expect(await executor({ url: 'https://api.example.test/users', method: 'POST', body })).toMatchObject({
      method: 'POST',
      body: expected,
      headers: { 'content-type': 'application/json' },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Content-Type', 'application/vnd.api+json'],
    ['content-type', 'application/json; charset=utf-8'],
    ['CONTENT-TYPE', 'text/plain'],
    ['Content-Type', ''],
  ])('preserves an explicitly declared %s header', async (name, value) => {
    const headers = Object.freeze({ [name]: value, 'X-Trace': 'abc' })
    const body = Object.freeze({ name: 'Ada' })
    const descriptor = Object.freeze({ url: 'https://api.example.test/users', method: 'POST', headers, body })
    const executor = createFetchExecutor({ fetch: createInspectingFetch() })

    expect(await executor(descriptor)).toMatchObject({
      headers: { 'content-type': value, 'x-trace': 'abc' },
      body: '{"name":"Ada"}',
    })
    expect(descriptor.headers).toBe(headers)
    expect(descriptor.body).toBe(body)
    expect(headers).toEqual({ [name]: value, 'X-Trace': 'abc' })
    expect(body).toEqual({ name: 'Ada' })
  })

  it('adds a JSON header without mutating the original header record', async () => {
    const headers = Object.freeze({ 'X-Trace': 'abc' })
    const executor = createFetchExecutor({ fetch: createInspectingFetch() })

    expect(await executor({ url: 'https://api.example.test/users', method: 'PATCH', body: [], headers })).toMatchObject({
      headers: { 'content-type': 'application/json', 'x-trace': 'abc' },
      body: '[]',
    })
    expect(headers).toEqual({ 'X-Trace': 'abc' })
  })

  it.each([undefined, { 'X-Trace': 'abc' }])('preserves JSON omission without adding a content type', async (headers) => {
    const executor = createFetchExecutor({ fetch: createInspectingFetch() })
    const result = await executor({
      url: 'https://api.example.test/users',
      method: 'POST',
      body: { toJSON: () => undefined },
      ...(headers ? { headers } : {}),
    })

    expect(result).toMatchObject({ body: '', headers: headers ? { 'x-trace': 'abc' } : {} })
    expect((result as { headers: Record<string, string> }).headers).not.toHaveProperty('content-type')
  })

  it.each(['query', 'mutation'])('encodes the default %s body with URL parameters and mock routing', async (operation) => {
    const controller = new AbortController()
    const fetch = createInspectingFetch()
    const client = createMokupQueryClient({
      fetch,
      resolverOptions: { mockBase: 'https://mock.example.test', markers: { header: true } },
    })
    const input = ['POST', '/users', { body: { name: 'Ada' }, params: { page: 2 }, mock: true }]
    const result = operation === 'query'
      ? await client.queryFn({ queryKey: input, signal: controller.signal })
      : await client.mutationFn(input)

    expect(result).toMatchObject({
      url: 'https://mock.example.test/users?page=2',
      method: 'POST',
      body: '{"name":"Ada"}',
      headers: { 'content-type': 'application/json', 'x-mokup': '1' },
    })
    if (operation === 'query') {
      expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
    }
  })

  it.each(['cycle', 'bigint'])('rejects a JSON %s before invoking Fetch', async (kind) => {
    const body: Record<string, unknown> = {}
    if (kind === 'cycle') {
      body['self'] = body
    }
    else {
      body['id'] = 1n
    }
    const headers = Object.freeze({ 'X-Trace': 'abc' })
    const fetch = createInspectingFetch()
    const executor = createFetchExecutor({ fetch })

    await expect(executor({ url: 'https://api.example.test/users', method: 'POST', body, headers })).rejects.toBeInstanceOf(TypeError)
    expect(fetch).not.toHaveBeenCalled()
    expect(headers).toEqual({ 'X-Trace': 'abc' })
    if (kind === 'cycle') {
      expect(body['self']).toBe(body)
    }
    else {
      expect(body['id']).toBe(1n)
    }
  })

  it('leaves body objects untouched for custom executors', async () => {
    const body = { name: 'Ada' }
    const executor = vi.fn<RequestExecutor>(async () => 'custom')
    const client = createMokupQueryClient({ executor })

    expect(await client.queryFn({ queryKey: ['POST', '/users', { body }] })).toBe('custom')
    expect(await client.mutationFn(['POST', '/users', { body }])).toBe('custom')
    expect(executor.mock.calls[0]?.[0]?.body).toBe(body)
    expect(executor.mock.calls[1]?.[0]?.body).toBe(body)
  })

  it('lets custom resolvers inspect the original body and set its wire content type', async () => {
    const body = { name: 'Ada' }
    const resolver = createMockResolver()
    const resolve = vi.spyOn(resolver, 'resolve').mockImplementation((request) => {
      expect(request.body).toBe(body)
      expect(request.headers).not.toHaveProperty('content-type')
      return {
        mode: 'real',
        url: 'https://api.example.test/users',
        headers: { 'Content-Type': 'application/vnd.api+json' },
      }
    })
    const executor = createFetchExecutor({ resolver, fetch: createInspectingFetch() })

    expect(await executor({ url: '/users', method: 'POST', body })).toMatchObject({
      headers: { 'content-type': 'application/vnd.api+json' },
      body: '{"name":"Ada"}',
    })
    expect(resolve).toHaveBeenCalledTimes(1)
  })
})
