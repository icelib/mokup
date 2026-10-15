import { describe, expect, it, vi } from 'vitest'
import { Hono } from '../src/hono'
import { applyContextResponseOverrides, applyResponseOverrides } from '../src/response-overrides'

describe('response overrides', () => {
  it('keeps final header overrides authoritative through Hono response replacement', async () => {
    const app = new Hono()
    app.use('*', async (c, next) => {
      await next()
      return applyContextResponseOverrides(c, c.res, {
        status: 205,
        headers: { 'x-value': 'route', 'set-cookie': 'route=1; Path=/' },
      })
    })
    app.get('/', () => new Response('payload', {
      headers: { 'content-length': '7', 'transfer-encoding': 'chunked', 'x-value': 'handler', 'set-cookie': 'handler=1' },
    }))
    const response = await app.request('/')
    expect(response.status).toBe(205)
    expect(response.body).toBeNull()
    expect(response.headers.get('x-value')).toBe('route')
    expect(response.headers.getSetCookie()).toEqual(['route=1; Path=/'])
    expect(response.headers.has('content-length')).toBe(false)
    expect(response.headers.has('transfer-encoding')).toBe(false)
  })

  it('cancels a HEAD payload while retaining its representation headers and status', async () => {
    const cancel = vi.fn()
    const source = new Response(new ReadableStream({ cancel }), {
      status: 201,
      headers: { 'content-length': '7', 'content-type': 'application/wasm' },
    })
    const result = applyResponseOverrides(source, {}, 'HEAD')
    expect(result.status).toBe(201)
    expect(result.body).toBeNull()
    expect(result.headers.get('content-length')).toBe('7')
    expect(result.headers.get('content-type')).toBe('application/wasm')
    expect(cancel).toHaveBeenCalledOnce()
    expect(await result.text()).toBe('')
  })

  it.each([204, 205, 304])('discards and cancels the source body for status %s', async (status) => {
    const cancel = vi.fn()
    const source = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])) },
      cancel,
    }), { headers: { 'x-source': 'retained' } })
    source.headers.append('set-cookie', 'first=1; Path=/')
    source.headers.append('set-cookie', 'second=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT')
    const result = applyResponseOverrides(source, { status, headers: { 'x-route': 'added' } })

    expect(result.status).toBe(status)
    expect(result.body).toBeNull()
    expect(await result.text()).toBe('')
    expect(cancel).toHaveBeenCalledOnce()
    expect(result.headers.get('x-source')).toBe('retained')
    expect(result.headers.get('x-route')).toBe('added')
    expect(result.headers.getSetCookie()).toEqual(source.headers.getSetCookie())
  })

  it.each([204, 205])('removes discarded payload framing for status %s', (status) => {
    const source = new Response('payload', {
      headers: { 'content-length': '7', 'transfer-encoding': 'chunked' },
    })
    const result = applyResponseOverrides(source, { status })
    expect(result.headers.has('content-length')).toBe(false)
    expect(result.headers.has('transfer-encoding')).toBe(false)
    expect(result.body).toBeNull()
  })

  it('retains representation metadata on 304 responses', () => {
    const result = applyResponseOverrides(new Response('payload', {
      headers: { 'content-length': '7', 'etag': '"version"' },
    }), { status: 304 })
    expect(result.headers.get('content-length')).toBe('7')
    expect(result.headers.get('etag')).toBe('"version"')
    expect(result.body).toBeNull()
  })

  it('corrects invalid framing even when the bodyless status stays the same', () => {
    const source = new Response(null, { status: 205, headers: { 'content-length': '7' } })
    const result = applyResponseOverrides(source, {})
    expect(result.status).toBe(205)
    expect(result.headers.has('content-length')).toBe(false)
  })

  it('contains cancellation failures when discarding a stream', async () => {
    const source = new Response(new ReadableStream({
      cancel() { return Promise.reject(new Error('producer cleanup failed')) },
    }))
    const result = applyResponseOverrides(source, { status: 204 })
    expect(result.body).toBeNull()
    await expect(source.body?.cancel()).resolves.toBeUndefined()
  })

  it('preserves identity without overrides and preserves ordinary response payloads', async () => {
    const source = new Response('payload', { headers: { 'x-source': 'retained' } })
    expect(applyResponseOverrides(source, {})).toBe(source)
    expect(applyResponseOverrides(source, { status: Number.NaN })).toBe(source)
    const changed = applyResponseOverrides(source, { status: 201, headers: { 'x-route': 'added' } })
    expect(changed.status).toBe(201)
    expect(changed.headers.get('x-source')).toBe('retained')
    expect(await changed.text()).toBe('payload')
  })
})
