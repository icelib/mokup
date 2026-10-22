import type { PlaywrightRoute, PlaywrightRouteTarget } from '../src/testing/playwright'
import { http, HttpResponse } from '@mokup/runtime/http'
import { describe, expect, it, vi } from 'vitest'
import { attachPlaywright } from '../src/testing/playwright'

function routing() {
  let handler: ((route: PlaywrightRoute) => Promise<void>) | undefined
  const target: PlaywrightRouteTarget = {
    route: vi.fn(async (_pattern, next) => { handler = next }),
    unroute: vi.fn(async () => {}),
  }
  const request = (method = 'GET', body: Uint8Array | null = null, url = 'https://test.example/api') => {
    const route = {
      request: () => ({ url: () => url, method: () => method, allHeaders: async () => ({ cookie: 'session=one' }), postDataBuffer: () => body }),
      fallback: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      fulfill: vi.fn(async (_response: Parameters<PlaywrightRoute['fulfill']>[0]) => {}),
    }
    return { route, run: () => handler!(route) }
  }
  return { target, request }
}

describe('Playwright request routing adapter', () => {
  it('preserves binary requests and fulfills native response bytes', async () => {
    const { target, request } = routing()
    const adapter = await attachPlaywright(target, {
      handlers: [http.post('/api', async ({ request, cookies }) => {
        expect(cookies['session']).toBe('one')
        return new Response(await request.arrayBuffer(), { status: 201, headers: { 'content-type': 'application/octet-stream' } })
      })],
    })
    const call = request('POST', new Uint8Array([0, 255, 128]))
    await call.run()
    const response = call.route.fulfill.mock.calls[0]![0]
    expect(response.status).toBe(201)
    expect([...response.body]).toEqual([0, 255, 128])
    expect(call.route.fallback).not.toHaveBeenCalled()
    await adapter.detach()
    expect(target.unroute).toHaveBeenCalledWith('**/*', vi.mocked(target.route).mock.calls[0]![1])
  })

  it('falls through unmatched routes and owns only its registered callback', async () => {
    const { target, request } = routing()
    const adapter = await attachPlaywright(target, { pattern: '**/api/**' })
    const call = request()
    await call.run()
    expect(call.route.fallback).toHaveBeenCalledOnce()
    const detached = adapter.detach()
    expect(adapter.detach()).toBe(detached)
    await detached
    expect(target.unroute).toHaveBeenCalledExactlyOnceWith('**/api/**', vi.mocked(target.route).mock.calls[0]![1])
  })

  it('reports failures from queued route callbacks while detaching', async () => {
    const { target, request } = routing()
    let finishRemoval: () => void = () => {}
    const removing = new Promise<void>((resolve) => {
      finishRemoval = resolve
    })
    vi.mocked(target.unroute).mockImplementation(() => removing)
    const adapter = await attachPlaywright(target)
    const detached = adapter.detach()
    const rejection = expect(detached).rejects.toThrow('Playwright mocking failed')
    try {
      const call = request()
      call.route.fallback.mockRejectedValueOnce(new Error('queued fallback failed'))
      await call.run()
      expect(adapter.errors()[0]?.message).toBe('queued fallback failed')
      expect(call.route.abort).toHaveBeenCalledWith('failed')
    }
    finally {
      finishRemoval()
      await rejection
    }
  })

  it('supports override lifecycle with isolated sessions', async () => {
    const left = routing()
    const right = routing()
    const handler = http.get('/api', () => HttpResponse.text('baseline'))
    const a = await attachPlaywright(left.target, { handlers: [handler] })
    const b = await attachPlaywright(right.target, { handlers: [handler] })
    a.use(http.get('/api', () => HttpResponse.text('once'), { once: true }))
    const one = left.request()
    await one.run()
    expect(one.route.fulfill.mock.calls[0]![0].body.toString()).toBe('once')
    a.restoreHandlers()
    const isolated = right.request()
    await isolated.run()
    expect(isolated.route.fulfill.mock.calls[0]![0].body.toString()).toBe('baseline')
    a.resetHandlers()
    const reset = left.request()
    await reset.run()
    expect(reset.route.fulfill.mock.calls[0]![0].body.toString()).toBe('baseline')
    await Promise.all([a.detach(), b.detach()])
  })

  it('aborts unhandled requests under error policy and reports the error at detach', async () => {
    const { target, request } = routing()
    const adapter = await attachPlaywright(target, { onUnhandled: 'error' })
    const call = request()
    await call.run()
    expect(call.route.abort).toHaveBeenCalledWith('failed')
    expect(adapter.errors()[0]?.message).toContain('Unhandled request')
    await expect(adapter.detach()).rejects.toThrow('Playwright mocking failed')
  })

  it('rejects oversized request and response bodies', async () => {
    for (const oversizedRequest of [false, true]) {
      const { target, request } = routing()
      const adapter = await attachPlaywright(target, { maxBodyBytes: 2, handlers: [http.all('/api', () => HttpResponse.text('long'))] })
      const call = oversizedRequest ? request('POST', new Uint8Array(3)) : request()
      await call.run()
      expect(call.route.abort).toHaveBeenCalledWith('failed')
      expect(adapter.errors()[0]?.message).toContain(oversizedRequest ? 'request exceeds' : 'response exceeds')
      await expect(adapter.detach()).rejects.toThrow()
    }
  })

  it('rejects an infinite response and cancels its reader', async () => {
    const { target, request } = routing()
    const cancel = vi.fn()
    const adapter = await attachPlaywright(target, {
      bodyTimeoutMs: 15,
      handlers: [http.get('/api', () => new Response(new ReadableStream({ cancel })))],
    })
    const call = request()
    await call.run()
    expect(call.route.abort).toHaveBeenCalledWith('failed')
    expect(adapter.errors()[0]?.message).toContain('infinite streams')
    expect(cancel).toHaveBeenCalledOnce()
    await expect(adapter.detach()).rejects.toThrow()
  })

  it('does not silently collapse multiple Set-Cookie fields', async () => {
    const { target, request } = routing()
    const adapter = await attachPlaywright(target, {
      handlers: [http.get('/api', () => new Response(null, { headers: [['set-cookie', 'a=1'], ['set-cookie', 'b=2']] }))],
    })
    const call = request()
    await call.run()
    expect(adapter.errors()[0]?.message).toContain('multiple Set-Cookie')
    expect(call.route.fulfill).not.toHaveBeenCalled()
    await expect(adapter.detach()).rejects.toThrow()
  })
})
