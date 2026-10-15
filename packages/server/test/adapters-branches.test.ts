import type { NodeRequestLike } from '../src/internal'
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectMiddleware, createFastifyPlugin, createKoaMiddleware } from '../src/node'

const runtimeHandle = vi.fn()

function request(url: string): NodeRequestLike {
  return { method: 'GET', url, headers: {}, body: '', on: vi.fn() }
}

vi.mock('@mokup/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mokup/runtime')>()
  return {
    ...actual,
    createRuntime: () => ({ hasRoute: async () => true, handle: runtimeHandle }),
  }
})

describe('server adapters extra branches', () => {
  afterEach(() => {
    runtimeHandle.mockReset()
  })
  it('connect middleware calls next when no match', async () => {
    runtimeHandle.mockResolvedValueOnce(null)
    const middleware = createConnectMiddleware({ manifest: { version: 1, routes: [] }, onNotFound: 'next' })
    const req = request('/missing')
    const res = { statusCode: 0, end: vi.fn() }
    const next = vi.fn()

    await middleware(req, res as any, next)
    expect(next).toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
  })

  it('connect middleware returns 404 when configured', async () => {
    runtimeHandle.mockResolvedValueOnce(null)
    const middleware = createConnectMiddleware({ manifest: { version: 1, routes: [] }, onNotFound: 'response' })
    const req = request('/missing')
    const res = { statusCode: 0, end: vi.fn() }

    await middleware(req, res as any, vi.fn())
    expect(res.statusCode).toBe(404)
    expect(res.end).toHaveBeenCalled()
  })

  it('koa middleware handles different body types', async () => {
    const middleware = createKoaMiddleware({ manifest: { version: 1, routes: [] }, onNotFound: 'response' })

    runtimeHandle.mockResolvedValueOnce({ status: 200, headers: {}, body: null })
    const ctxNull = {
      req: request('/null'),
      request: { body: '' },
      status: 0,
      body: undefined,
      set: vi.fn(),
    }
    await middleware(ctxNull as any, async () => {})
    expect(ctxNull.body).toBeNull()

    runtimeHandle.mockResolvedValueOnce({ status: 200, headers: {}, body: 'ok' })
    const ctxText = {
      req: request('/text'),
      request: { body: '' },
      status: 0,
      body: undefined,
      set: vi.fn(),
    }
    await middleware(ctxText as any, async () => {})
    expect(ctxText.body).toBe('ok')

    runtimeHandle.mockResolvedValueOnce({ status: 200, headers: {}, body: new Uint8Array([1, 2]) })
    const ctxBin = {
      req: request('/bin'),
      request: { body: '' },
      status: 0,
      body: undefined,
      set: vi.fn(),
    }
    await middleware(ctxBin as any, async () => {})
    expect(ctxBin.body).toEqual(Buffer.from([1, 2]))
  })

  it('fastify plugin handles not found and binary bodies', async () => {
    const plugin = createFastifyPlugin({ manifest: { version: 1, routes: [] }, onNotFound: 'response' })
    let hook: ((request: any, reply: any) => Promise<void>) | undefined
    const instance = {
      addHook: (_name: 'onRequest', handler: typeof hook) => {
        hook = handler
      },
    }
    await plugin(instance)

    const reply = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn(),
    }

    runtimeHandle.mockResolvedValueOnce(null)
    await hook?.(request('/missing'), reply)
    expect(reply.status).toHaveBeenCalledWith(404)

    runtimeHandle.mockResolvedValueOnce({ status: 200, headers: { 'x-test': '1' }, body: new Uint8Array([3]) })
    await hook?.(request('/bin'), reply)
    expect(reply.header).toHaveBeenCalledWith('x-test', '1')
    expect(reply.send).toHaveBeenCalled()
  })

  it('fastify plugin handles null and string bodies', async () => {
    const plugin = createFastifyPlugin({ manifest: { version: 1, routes: [] }, onNotFound: 'next' })
    let hook: ((request: any, reply: any) => Promise<void>) | undefined
    const instance = {
      addHook: (_name: 'onRequest', handler: typeof hook) => {
        hook = handler
      },
    }
    await plugin(instance)

    const reply = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn(),
    }

    runtimeHandle.mockResolvedValueOnce({ status: 204, headers: {}, body: null })
    await hook?.(request('/empty'), reply)
    expect(reply.send).toHaveBeenCalled()

    runtimeHandle.mockResolvedValueOnce({ status: 200, headers: {}, body: 'ok' })
    await hook?.(request('/text'), reply)
    expect(reply.send).toHaveBeenCalledWith('ok')
  })
})
