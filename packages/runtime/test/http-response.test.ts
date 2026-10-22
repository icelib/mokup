import { describe, expect, it, vi } from 'vitest'
import { createMockSession, delay, getResponseCookies, http, HttpResponse } from '../src/http'

describe('HTTP responses and request resources', () => {
  it('waits for every stream cleanup before reporting a cancellation failure', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const failure = new Error('first stream failed')
    const session = createMockSession(http.get('/stream/:id', ({ params }) => new Response(new ReadableStream({
      async cancel() {
        if (params.id === 'first') {
          throw failure
        }
        entered.resolve()
        await release.promise
      },
    }))))
    await session.handle(new Request('https://example.test/stream/first'))
    await session.handle(new Request('https://example.test/stream/second'))
    let settled = false
    const disposal = session.dispose().then(() => {
      settled = true
      return undefined
    }, (error: unknown) => {
      settled = true
      return error
    })
    try {
      await entered.promise
      await delay(1)
      expect(settled).toBe(false)
    }
    finally {
      release.resolve()
    }
    expect(await disposal).toBeInstanceOf(AggregateError)
    expect(settled).toBe(true)
  })

  it('retains duplicate response cookies through cloning, streaming and HEAD normalization', async () => {
    const cookies = ['one=1; Path=/', 'two=2; Path=/']
    const response = HttpResponse.text('body', { headers: cookies.map(cookie => ['set-cookie', cookie]) })
    expect(getResponseCookies(response.clone())).toEqual(cookies)
    response.headers.append('set-cookie', 'three=3')
    expect(getResponseCookies(response)).toEqual([...cookies, 'three=3'])
    response.headers.delete('set-cookie')
    expect(getResponseCookies(response)).toEqual([])
    const session = createMockSession(http.all('/cookies', () => HttpResponse.text('body', { headers: cookies.map(cookie => ['set-cookie', cookie]) })))
    try {
      for (const method of ['GET', 'HEAD']) {
        const result = await session.handle(new Request('https://example.test/cookies', { method }))
        expect(getResponseCookies(result!)).toEqual(cookies)
        await result?.text()
      }
    }
    finally {
      await session.dispose()
    }
  })

  it('creates JSON, text, HTML, XML, binary, and FormData responses with explicit overrides', async () => {
    expect(await HttpResponse.json({ ok: true }).json()).toEqual({ ok: true })
    expect(HttpResponse.json().body).toBeNull()
    expect(HttpResponse.text('hello').headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(HttpResponse.html('<b>hello</b>').headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(HttpResponse.xml('<root/>').headers.get('content-type')).toBe('application/xml')
    const source = new Uint8Array([0, 255, 128])
    const binary = HttpResponse.arrayBuffer(source.subarray(1))
    source.fill(42)
    expect(new Uint8Array(await binary.arrayBuffer())).toEqual(new Uint8Array([255, 128]))
    const form = new FormData()
    form.append('name', 'Ada')
    expect((await HttpResponse.formData(form).formData()).get('name')).toBe('Ada')
    const custom = HttpResponse.json({ ok: true }, { status: 201, headers: { 'content-type': 'application/problem+json' } })
    expect(custom.status).toBe(201)
    expect(custom.headers.get('content-type')).toBe('application/problem+json')
    expect(HttpResponse.error().type).toBe('error')
    const redirect = HttpResponse.redirect('https://example.test/next', 307)
    expect(redirect.status).toBe(307)
    expect(redirect.headers.get('location')).toBe('https://example.test/next')
    expect(await redirect.text()).toBe('')
  })

  it('normalizes bodyless status framing for native handlers', async () => {
    const session = createMockSession(
      http.get('/empty', () => new Response(null, { status: 204, headers: { 'content-length': '4', 'transfer-encoding': 'chunked' } })),
      http.get('/cached', () => new Response(null, { status: 304, headers: { 'content-length': '4', 'etag': 'W/"cached"' } })),
    )
    try {
      const empty = await session.handle(new Request('https://example.test/empty'))
      expect(empty?.status).toBe(204)
      expect(empty?.headers.has('content-length')).toBe(false)
      expect(empty?.headers.has('transfer-encoding')).toBe(false)
      const cached = await session.handle(new Request('https://example.test/cached'))
      expect(cached?.status).toBe(304)
      expect(cached?.headers.get('content-length')).toBe('4')
      expect(cached?.headers.get('etag')).toBe('W/"cached"')
    }
    finally {
      await session.dispose()
    }
  })

  it('aborts finite and infinite delays and removes timers', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const finite = delay(10_000, { signal: controller.signal })
      const infinite = delay('infinite', { signal: controller.signal })
      const expected = Promise.all([
        expect(finite).rejects.toBe('cancelled'),
        expect(infinite).rejects.toBe('cancelled'),
      ])
      controller.abort('cancelled')
      await expected
      expect(vi.getTimerCount()).toBe(0)
      await expect(delay(-1)).rejects.toThrow(RangeError)
      const completed = delay(25)
      await vi.advanceTimersByTimeAsync(25)
      await completed
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('keeps streamed chunks incremental and finalizes after cancellation', async () => {
    const cleanup = vi.fn()
    const cancel = vi.fn()
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const session = createMockSession(http.get('/stream', ({ finalize }) => {
      finalize(cleanup)
      return new Response(new ReadableStream({
        start(controller) { stream = controller },
        cancel,
      }))
    }))
    const response = await session.handle(new Request('https://example.test/stream'))
    const reader = response!.body!.getReader()
    stream.enqueue(new TextEncoder().encode('first'))
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
    expect(cleanup).not.toHaveBeenCalled()
    await reader.cancel('finished')
    expect(cancel).toHaveBeenCalledWith('finished')
    expect(cleanup).toHaveBeenCalledOnce()
    await session.dispose()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('aborts pending requests and releases response resources during disposal', async () => {
    const cleanup = vi.fn()
    const entered = Promise.withResolvers<void>()
    const session = createMockSession(http.get('/slow', async ({ request, finalize }) => {
      finalize(cleanup)
      entered.resolve()
      await delay('infinite', { signal: request.signal })
      return HttpResponse.text('unreachable')
    }))
    const pending = session.handle(new Request('https://example.test/slow'))
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    await session.dispose()
    await rejected
    expect(cleanup).toHaveBeenCalledOnce()
    await session.dispose()
  })

  it('propagates a caller abort after response headers without consuming the stream', async () => {
    const abort = new AbortController()
    const cleanup = vi.fn()
    const cancelled = vi.fn()
    const session = createMockSession(http.get('/stream', ({ finalize }) => {
      finalize(cleanup)
      return new Response(new ReadableStream({ cancel: cancelled }))
    }))
    const response = await session.handle(new Request('https://example.test/stream', { signal: abort.signal }))
    const pending = response!.body!.getReader().read()
    const rejected = expect(pending).rejects.toBe('caller abort')
    abort.abort('caller abort')
    await rejected
    await session.dispose()
    expect(cancelled).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('waits for asynchronous HEAD body cancellation before returning and finalizing', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const finalized = vi.fn()
    const session = createMockSession(http.head('/stream', ({ finalize }) => {
      finalize(finalized)
      return new Response(new ReadableStream({
        cancel() {
          entered.resolve()
          return release.promise
        },
      }), { headers: { 'content-length': '4' } })
    }))
    let completed = false
    const pending = session.handle(new Request('https://example.test/stream', { method: 'HEAD' })).then((response) => {
      completed = true
      return response
    })
    await entered.promise
    expect(completed).toBe(false)
    expect(finalized).not.toHaveBeenCalled()
    release.resolve()
    const response = await pending
    expect(response?.body).toBeNull()
    expect(response?.headers.get('content-length')).toBe('4')
    expect(finalized).toHaveBeenCalledOnce()
    await session.dispose()
  })

  it.each(['GET', 'HEAD'])('awaits underlying %s stream cancellation during session disposal', async (method) => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const finalized = vi.fn()
    const session = createMockSession(http.all('/stream', ({ finalize }) => {
      finalize(finalized)
      return new Response(new ReadableStream({
        cancel() {
          entered.resolve()
          return release.promise
        },
      }))
    }))
    const pending = session.handle(new Request('https://example.test/stream', { method }))
    let requestDone: Promise<unknown>
    if (method === 'HEAD') {
      requestDone = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await entered.promise
    }
    else {
      const response = await pending
      requestDone = expect(response?.text()).rejects.toMatchObject({ name: 'AbortError' })
    }
    let disposed = false
    const closing = session.dispose().then(() => {
      disposed = true
    })
    await entered.promise
    await Promise.resolve()
    expect(disposed).toBe(false)
    release.resolve()
    await Promise.all([closing, requestDone])
    expect(finalized).toHaveBeenCalledOnce()
  })

  it('surfaces failed HEAD cancellation and still runs finalizers', async () => {
    const failure = new Error('cancel failed')
    const finalize = vi.fn()
    const session = createMockSession(http.head('/stream', (context) => {
      context.finalize(finalize)
      return new Response(new ReadableStream({ cancel: async () => {
        throw failure
      } }))
    }))
    await expect(session.handle(new Request('https://example.test/stream', { method: 'HEAD' }))).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [failure],
    })
    expect(finalize).toHaveBeenCalledOnce()
    await session.dispose()
  })
})
