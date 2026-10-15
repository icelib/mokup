import type { RuntimeRequest } from '@mokup/runtime'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createConnectMiddleware } from '../src/connect'
import { createFetchHandler } from '../src/fetch'
import { handleFetchRequest, handleNodeRequest } from '../src/internal/handle-request'

function runtime(matched: boolean) {
  return {
    hasRoute: vi.fn(async (_request: Pick<RuntimeRequest, 'method' | 'path'>) => matched),
    handle: vi.fn(async (request: RuntimeRequest) => ({ status: 200, headers: {}, body: JSON.stringify(request.body) })),
  }
}

describe('request dispatch before reading bodies', () => {
  it('does not inspect a Node body or attach body listeners for an unmatched route', async () => {
    const body = vi.fn(() => {
      throw new Error('Body must remain untouched')
    })
    const req = {
      method: 'POST',
      url: '/native?x=1&x=2',
      headers: { 'content-type': 'application/json' },
      get body() { return body() },
      on: vi.fn(),
    }
    const engine = runtime(false)
    expect(await handleNodeRequest(engine, req)).toBeNull()
    expect(engine.hasRoute).toHaveBeenCalledExactlyOnceWith({
      method: 'POST',
      path: '/native',
    })
    expect(engine.handle).not.toHaveBeenCalled()
    expect(body).not.toHaveBeenCalled()
    expect(req.on.mock.calls.some(([event]) => event === 'data' || event === 'end')).toBe(false)
  })

  it('waits for route ownership before reading a matched raw Node stream', async () => {
    const engine = runtime(true)
    let finishMatch!: (matched: boolean) => void
    let matchingStarted!: () => void
    const started = new Promise<void>((resolve) => {
      matchingStarted = resolve
    })
    engine.hasRoute.mockImplementationOnce(() => new Promise((resolve) => {
      finishMatch = resolve
      matchingStarted()
    }))
    const req = Object.assign(new PassThrough(), {
      method: 'POST',
      url: '/mock/42',
      headers: { 'content-type': 'application/json' },
    })
    try {
      const pending = handleNodeRequest(engine, req)
      await started
      expect(req.listenerCount('data')).toBe(0)
      req.end('{"ok":true}')
      finishMatch(true)
      expect(await pending).toMatchObject({ body: '{"ok":true}' })
      expect(engine.handle).toHaveBeenCalledExactlyOnceWith({
        method: 'POST',
        path: '/mock/42',
        query: {},
        headers: { 'content-type': 'application/json' },
        body: { ok: true },
        rawBody: '{"ok":true}',
        rawBodyBytes: new TextEncoder().encode('{"ok":true}'),
      })
    }
    finally {
      req.destroy()
    }
  })

  it.each([false, true])('keeps already parsed Node bodies and explicit overrides: %s', async (override) => {
    const engine = runtime(true)
    const req = { method: 'POST', url: '/mock', body: { source: 'request' }, on: vi.fn() }
    await handleNodeRequest(engine, req, override ? { source: 'override' } : undefined)
    expect(engine.handle.mock.calls[0]?.[0].body).toEqual({ source: override ? 'override' : 'request' })
    expect(req.on.mock.calls.some(([event]) => event === 'data' || event === 'end')).toBe(false)
  })

  it('validates a Node URL before matching or consuming its body', async () => {
    const engine = runtime(false)
    const req = { method: 'POST', url: '/', headers: { host: 'bad/host' }, on: vi.fn() }
    await expect(handleNodeRequest(engine, req)).rejects.toMatchObject({ status: 400, statusCode: 400 })
    expect(engine.hasRoute).not.toHaveBeenCalled()
    expect(engine.handle).not.toHaveBeenCalled()
    expect(req.on).not.toHaveBeenCalled()
  })

  it('leaves a Fetch body untouched even when matching fails with an error', async () => {
    const engine = runtime(true)
    engine.hasRoute.mockRejectedValueOnce(new Error('Manifest failed'))
    const request = new Request('http://localhost/mock', { method: 'POST', body: 'payload' })
    await expect(handleFetchRequest(engine, request)).rejects.toThrow('Manifest failed')
    expect(request.bodyUsed).toBe(false)
    expect(request.body?.locked).toBe(false)
    expect(await request.text()).toBe('payload')
    expect(engine.handle).not.toHaveBeenCalled()
  })

  it('does not clone or read an unmatched Fetch request', async () => {
    const engine = runtime(false)
    const request = new Request('http://localhost/native', { method: 'POST', body: 'payload' })
    const clone = vi.spyOn(request, 'clone')
    expect(await handleFetchRequest(engine, request)).toBeNull()
    expect(request.bodyUsed).toBe(false)
    expect(request.body?.locked).toBe(false)
    expect(clone).not.toHaveBeenCalled()
    expect(await request.text()).toBe('payload')
  })

  it('returns configured 404 responses without waiting for an unmatched Node body', async () => {
    const middleware = createConnectMiddleware({ manifest: { version: 1, routes: [] }, onNotFound: 'response' })
    const req = { method: 'POST', url: '/native', on: vi.fn() }
    const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() }
    const next = vi.fn()
    await middleware(req, res, next)
    expect(res.statusCode).toBe(404)
    expect(res.end).toHaveBeenCalledExactlyOnceWith()
    expect(req.on.mock.calls.some(([event]) => event === 'data' || event === 'end')).toBe(false)
    expect(next).not.toHaveBeenCalled()
  })

  it('preserves Fetch request bodies with the configured 404 policy', async () => {
    const handler = createFetchHandler({ manifest: { version: 1, routes: [] }, onNotFound: 'response' })
    const request = new Request('http://localhost/native', { method: 'POST', body: 'payload' })
    expect((await handler(request))?.status).toBe(404)
    expect(request.bodyUsed).toBe(false)
    expect(await request.text()).toBe('payload')
  })

  it.each(['error', 'close'] as const)('forwards request %s while manifest loading is still pending', async (mode) => {
    let completeManifest!: (manifest: { version: 1, routes: [] }) => void
    let loadingStarted!: () => void
    const started = new Promise<void>((resolve) => {
      loadingStarted = resolve
    })
    const middleware = createConnectMiddleware({
      manifest: () => new Promise((resolve) => {
        completeManifest = resolve
        loadingStarted()
      }),
    })
    const stream = Object.assign(new PassThrough(), { method: 'POST', url: '/native' })
    const next = vi.fn()
    const res = { setHeader: vi.fn(), end: vi.fn() }
    const pending = middleware(stream, res, next)
    const failure = new Error('request interrupted during manifest lookup')
    try {
      await started
      expect(stream.listenerCount('data')).toBe(0)
      stream.destroy(mode === 'error' ? failure : undefined)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(next).toHaveBeenCalledExactlyOnceWith(mode === 'error'
        ? failure
        : expect.objectContaining({ code: 'ERR_STREAM_PREMATURE_CLOSE' }))
      expect(res.end).not.toHaveBeenCalled()
    }
    finally {
      completeManifest({ version: 1, routes: [] })
      await pending
      stream.destroy()
    }
    expect(next).toHaveBeenCalledOnce()
  })
})
