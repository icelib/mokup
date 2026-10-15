import type { MockResolver } from '../src/core'
import type { MokupFetchInit } from '../src/fetch'
import { describe, expect, it, vi } from 'vitest'
import { createFetchAdapter } from '../src/adapters/fetch'

function resolver(rewrite = false): MockResolver {
  return {
    resolve: vi.fn<MockResolver['resolve']>(request => ({
      mode: 'real',
      url: rewrite ? request.url.replace('/source', '/rewritten') : request.url,
      headers: { 'x-resolver': '1' },
    })),
    setUseMock: vi.fn(),
    getUseMock: () => false,
  }
}

describe('fetch Request normalization', () => {
  it.each([undefined, null])('inherits effective body, method and signal when overrides are %s', async (body) => {
    const controller = new AbortController()
    const input = new Request('http://localhost/source', {
      method: 'POST',
      body: 'original',
      signal: controller.signal,
      headers: { 'x-original': 'old' },
    })
    const selected = resolver()
    const fetchMock = vi.fn<typeof fetch>(async (value, init) => {
      const request = new Request(value, init)
      expect(request.method).toBe('POST')
      expect(await request.text()).toBe('original')
      controller.abort('propagated')
      expect(request.signal.aborted).toBe(true)
      expect(request.signal.reason).toBe('propagated')
      return new Response('ok')
    })
    const adapter = createFetchAdapter({ fetch: fetchMock, resolver: selected })
    await adapter(input, { body, method: undefined, signal: undefined, mock: false } as unknown as MokupFetchInit)

    const [effective, init] = fetchMock.mock.calls[0]!
    expect(effective).toBeInstanceOf(Request)
    expect(Object.keys(init ?? {})).toEqual(['headers'])
    expect(selected.resolve).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', mock: false }))
  })

  it('uses native replacement semantics for headers and body before resolving', async () => {
    const input = new Request('http://localhost/source', {
      method: 'POST',
      body: 'old',
      headers: { 'x-old': 'old' },
    })
    const selected = resolver(true)
    const fetchMock = vi.fn<typeof fetch>(async (value, init) => {
      const request = new Request(value, init)
      expect(request.url).toBe('http://localhost/rewritten')
      expect(await request.text()).toBe('new')
      expect(request.headers.get('x-old')).toBeNull()
      expect(request.headers.get('x-new')).toBe('new')
      expect(request.headers.get('x-resolver')).toBe('1')
      return new Response('ok')
    })
    await createFetchAdapter({ fetch: fetchMock, resolver: selected })(input, {
      body: 'new',
      headers: { 'x-new': 'new' },
    })
    expect(selected.resolve).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-new': 'new' },
    }))
  })

  it('retains effective request options and replayable bytes after URL rewriting', async () => {
    const controller = new AbortController()
    const input = new Request('http://localhost/source', {
      method: 'POST',
      body: 'payload',
      signal: controller.signal,
      cache: 'no-cache',
      credentials: 'include',
      redirect: 'manual',
      mode: 'cors',
      referrer: 'http://localhost/page',
      referrerPolicy: 'origin',
      keepalive: true,
      integrity: 'sha256-test',
    })
    const fetchMock = vi.fn<typeof fetch>(async (_value, init) => {
      expect(init).toMatchObject({
        method: 'POST',
        cache: 'no-cache',
        credentials: 'include',
        redirect: 'manual',
        mode: 'cors',
        referrer: 'http://localhost/page',
        referrerPolicy: 'origin',
        keepalive: true,
        integrity: 'sha256-test',
      })
      expect(init?.body).toBeInstanceOf(Blob)
      expect(new TextDecoder().decode(await (init?.body as Blob).arrayBuffer())).toBe('payload')
      controller.abort('reason')
      expect(init?.signal?.reason).toBe('reason')
      return new Response('ok')
    })
    await createFetchAdapter({ fetch: fetchMock, resolver: resolver(true) })(input, {
      referrer: 'http://localhost/page',
      referrerPolicy: 'origin',
    })
  })

  it.each(['used', 'locked'] as const)('rejects a %s Request body before resolution or dispatch', async (state) => {
    const input = new Request('http://localhost/source', { method: 'POST', body: 'payload' })
    const reader = state === 'locked' ? input.body!.getReader() : undefined
    if (state === 'used') {
      await input.text()
    }
    const selected = resolver(true)
    const fetchMock = vi.fn<typeof fetch>()
    try {
      await expect(createFetchAdapter({ fetch: fetchMock, resolver: selected })(input)).rejects.toBeInstanceOf(TypeError)
      expect(selected.resolve).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    }
    finally {
      reader?.releaseLock()
    }
  })

  it.each(['string', 'URL'] as const)('passes %s input BodyInit through without buffering', async (kind) => {
    const form = new FormData()
    form.set('field', 'value')
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('ok'))
    const input = kind === 'URL' ? new URL('http://localhost/source') : 'http://localhost/source'
    await createFetchAdapter({ fetch: fetchMock, resolver: resolver(true) })(input, {
      method: 'POST',
      body: form,
      mock: false,
      meta: { test: true },
    })
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(form)
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('mock')
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('meta')
  })

  it('does not dispatch when already aborted or when aborted during rewriting', async () => {
    for (const alreadyAborted of [true, false]) {
      const controller = new AbortController()
      const cancel = vi.fn()
      const input = new Request('http://localhost/source', {
        method: 'POST',
        body: new ReadableStream({ cancel }),
        signal: controller.signal,
        duplex: 'half',
      } as RequestInit)
      const reason = new Error('stop')
      if (alreadyAborted) {
        controller.abort(reason)
      }
      const fetchMock = vi.fn<typeof fetch>()
      const pending = createFetchAdapter({ fetch: fetchMock, resolver: resolver(true) })(input)
      controller.abort(reason)
      await expect(pending).rejects.toBe(reason)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(cancel).toHaveBeenCalledExactlyOnceWith(reason)
    }
  })
})
