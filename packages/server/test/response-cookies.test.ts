import type { RuntimeResult } from '@mokup/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFetchHandler } from '../src/fetch'
import { applyRuntimeResultToNode } from '../src/internal/runtime'
import { createKoaMiddleware } from '../src/koa'

const runtimeHandle = vi.hoisted(() => vi.fn())
vi.mock('@mokup/runtime', async importOriginal => ({
  ...await importOriginal<typeof import('@mokup/runtime')>(),
  createRuntime: () => ({ hasRoute: async () => true, handle: runtimeHandle }),
}))

const cookies = ['a=one; Expires=Wed, 21 Oct 2037 07:28:00 GMT', 'b=two; Path=/']
const result: RuntimeResult = {
  status: 200,
  headers: { 'Set-Cookie': 'legacy=ignored', 'SET-cookie': cookies[1]!, 'X-Test': 'kept' },
  setCookies: cookies,
  body: 'ok',
}

describe('response cookie compatibility', () => {
  afterEach(() => runtimeHandle.mockReset())

  it('replaces a Node response cookie before appending the remaining fields', () => {
    const written = new Map<string, string[]>([['set-cookie', ['previous=removed']]])
    const response = {
      setHeader: (name: string, value: string) => written.set(name.toLowerCase(), [value]),
      appendHeader: (name: string, value: string) => written.get(name.toLowerCase())!.push(value),
      end: vi.fn(),
    }
    applyRuntimeResultToNode(response, result)

    expect(written.get('set-cookie')).toEqual(cookies)
    expect(written.get('x-test')).toEqual(['kept'])
    expect(response.end).toHaveBeenCalledExactlyOnceWith('ok')
    expect(result.headers).toEqual({ 'Set-Cookie': 'legacy=ignored', 'SET-cookie': cookies[1], 'X-Test': 'kept' })
  })

  it('preserves the legacy scalar Node response contract without appendHeader', () => {
    const headers: Record<string, string> = {}
    applyRuntimeResultToNode({
      setHeader: (name, value) => headers[name.toLowerCase()] = value,
      end: vi.fn(),
    }, result)

    expect(headers).toEqual({ 'set-cookie': cookies[1], 'x-test': 'kept' })
  })

  it.each([true, false])('honors the Koa append capability: %s', async (supportsAppend) => {
    runtimeHandle.mockResolvedValueOnce(result)
    const written = new Map<string, string[]>([['set-cookie', ['previous=removed']]])
    const ctx = {
      req: { method: 'GET', url: '/cookies', body: '', on: vi.fn() },
      set: (headers: Record<string, string>) => {
        for (const [name, value] of Object.entries(headers)) {
          written.set(name.toLowerCase(), [value])
        }
      },
      ...(supportsAppend
        ? { append: (name: string, value: string) => written.get(name.toLowerCase())!.push(value) }
        : {}),
    }
    await createKoaMiddleware({ manifest: { version: 1, routes: [] } })(ctx, async () => {})

    expect(written.get('set-cookie')).toEqual(supportsAppend ? cookies : [cookies[1]])
    expect(written.get('x-test')).toEqual(['kept'])
  })

  it('uses complete cookie metadata without duplicating any case of the legacy scalar header', async () => {
    runtimeHandle.mockResolvedValueOnce(result)
    const handler = createFetchHandler({ manifest: { version: 1, routes: [] } })
    const response = await handler(new Request('http://localhost/cookies'))

    expect(response?.headers.getSetCookie()).toEqual(cookies)
    expect(response?.headers.get('x-test')).toBe('kept')
  })

  it('accepts older runtime results with only a scalar cookie header', async () => {
    runtimeHandle.mockResolvedValueOnce({ status: 200, headers: { 'Set-Cookie': cookies[0] }, body: null })
    const handler = createFetchHandler({ manifest: { version: 1, routes: [] } })
    const response = await handler(new Request('http://localhost/cookies'))

    expect(response?.headers.getSetCookie()).toEqual([cookies[0]])
  })
})
