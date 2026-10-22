import { parseRouteTemplate } from '@mokup/runtime'
import { HttpResponse } from '@mokup/runtime/http'
import { describe, expect, it, vi } from 'vitest'
import { createHonoApp } from '../src/dev/hono'

function makeRoute(url: string, handler: any, extra: Record<string, unknown> = {}) {
  const parsed = parseRouteTemplate(url)
  return {
    file: `${url}.ts`,
    template: parsed.template,
    method: 'GET',
    tokens: parsed.tokens,
    score: parsed.score,
    handler,
    ...extra,
  }
}

describe('dev hono app', () => {
  it('preserves HttpResponse status, headers and body after Response replacement', async () => {
    const NativeResponse = Response
    vi.stubGlobal('Response', class ReplacementResponse extends NativeResponse {})
    try {
      const app = createHonoApp([{
        ...makeRoute('/typed', () => HttpResponse.text('typed', { status: 202 })),
        method: 'GET',
        headers: { 'x-file-route': 'kept' },
      }])
      const response = await app.fetch(new Request('http://mokup.local/typed'))
      expect(response.status).toBe(202)
      expect(response.headers.get('x-file-route')).toBe('kept')
      expect(await response.text()).toBe('typed')
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('normalizes handler values and applies overrides', async () => {
    vi.useFakeTimers()
    const onResponse = vi.fn(() => {
      throw new Error('hook failed')
    })

    const routes = [
      makeRoute('/status', () => undefined, {
        status: 201,
        headers: { 'x-test': '1' },
        delay: 5,
      }),
      makeRoute('/text', () => 'ok'),
      makeRoute('/binary', () => new ArrayBuffer(2)),
      makeRoute('/json', () => ({ ok: true })),
      makeRoute('/response', () => new Response('resp')),
      {
        ...makeRoute('/mw', () => 'fallback'),
        middlewares: [
          {
            handle: async (_c: any, _next: () => Promise<void>) => ({ res: new Response('mw') }),
            source: 'mw',
            index: 0,
            position: 'pre',
          },
        ],
      },
    ]

    const app = createHonoApp(routes as any, { onResponse })

    const statusPromise = app.fetch(new Request('http://mokup.local/status'))
    await vi.runAllTimersAsync()
    const statusResponse = await statusPromise
    expect(statusResponse.status).toBe(201)
    expect(statusResponse.headers.get('x-test')).toBe('1')
    await expect(statusResponse.text()).resolves.toBe('')

    const textResponse = await app.fetch(new Request('http://mokup.local/text'))
    await expect(textResponse.text()).resolves.toBe('ok')

    const binaryResponse = await app.fetch(new Request('http://mokup.local/binary'))
    expect(binaryResponse.headers.get('content-type')).toBe('application/octet-stream')

    const jsonResponse = await app.fetch(new Request('http://mokup.local/json'))
    await expect(jsonResponse.json()).resolves.toEqual({ ok: true })

    const responseResponse = await app.fetch(new Request('http://mokup.local/response'))
    await expect(responseResponse.text()).resolves.toBe('resp')

    const middlewareResponse = await app.fetch(new Request('http://mokup.local/mw'))
    await expect(middlewareResponse.text()).resolves.toBe('mw')

    expect(onResponse).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('handles onResponse promise rejections and root routes', async () => {
    const onResponse = vi.fn(() => Promise.reject(new Error('fail')))
    const parsed = parseRouteTemplate('/')
    const app = createHonoApp([
      {
        file: 'root.get.ts',
        template: parsed.template,
        method: 'GET',
        tokens: parsed.tokens,
        score: parsed.score,
        handler: () => new Response('root', { status: 200 }),
      },
    ] as any, { onResponse })

    const response = await app.fetch(new Request('http://mokup.local/'))
    await expect(response.text()).resolves.toBe('root')
    expect(onResponse).toHaveBeenCalled()
  })

  it('supports params, catchalls, and normal middlewares', async () => {
    const paramParsed = parseRouteTemplate('/users/[id]')
    const catchallParsed = parseRouteTemplate('/files/[...path]')
    const statusParsed = parseRouteTemplate('/status')
    const mwParsed = parseRouteTemplate('/mw')
    const normal = vi.fn(async (_c: any, next: () => Promise<void>) => {
      await next()
    })

    const app = createHonoApp([
      {
        file: 'users.get.ts',
        template: paramParsed.template,
        method: 'GET',
        tokens: paramParsed.tokens,
        score: paramParsed.score,
        handler: () => new Response('param'),
      },
      {
        file: 'files.get.ts',
        template: catchallParsed.template,
        method: 'GET',
        tokens: catchallParsed.tokens,
        score: catchallParsed.score,
        handler: () => 'catchall',
      },
      {
        file: 'status.get.ts',
        template: statusParsed.template,
        method: 'GET',
        tokens: statusParsed.tokens,
        score: statusParsed.score,
        handler: (c: any) => {
          c.status(400)
          return undefined
        },
      },
      {
        file: 'mw.get.ts',
        template: mwParsed.template,
        method: 'GET',
        tokens: mwParsed.tokens,
        score: mwParsed.score,
        handler: () => 'mw',
        middlewares: [
          { handle: normal, source: 'mw', index: 0, position: 'normal' },
        ],
      },
    ] as any)

    const paramResponse = await app.fetch(new Request('http://mokup.local/users/123'))
    await expect(paramResponse.text()).resolves.toBe('param')

    const catchallResponse = await app.fetch(new Request('http://mokup.local/files/a/b'))
    await expect(catchallResponse.text()).resolves.toBe('catchall')

    const statusResponse = await app.fetch(new Request('http://mokup.local/status'))
    expect(statusResponse.status).toBe(400)
    await expect(statusResponse.text()).resolves.toBe('')

    const mwResponse = await app.fetch(new Request('http://mokup.local/mw'))
    await expect(mwResponse.text()).resolves.toBe('mw')
    expect(normal).toHaveBeenCalled()
  })

  it('handles post middlewares and binary headers', async () => {
    const mwParsed = parseRouteTemplate('/mw')
    const binParsed = parseRouteTemplate('/binary-uint')
    let preCalled = false
    let postCalled = false
    const app = createHonoApp([
      {
        file: 'mw.get.ts',
        template: mwParsed.template,
        method: 'GET',
        tokens: mwParsed.tokens,
        score: mwParsed.score,
        handler: () => 'ok',
        middlewares: [
          {
            handle: async (_c: any, next: () => Promise<void>) => {
              preCalled = true
              await next()
              return new Response('mw')
            },
            source: 'mw',
            index: 0,
            position: 'pre',
          },
          {
            handle: async (_c: any, next: () => Promise<void>) => {
              postCalled = true
              await next()
              return { res: 'bad' }
            },
            source: 'mw',
            index: 1,
            position: 'post',
          },
        ],
      },
      {
        file: 'binary.get.ts',
        template: binParsed.template,
        method: 'GET',
        tokens: binParsed.tokens,
        score: binParsed.score,
        handler: (c: any) => {
          c.header('content-type', 'application/custom')
          return new Uint8Array([1, 2])
        },
      },
    ] as any)

    const mwResponse = await app.fetch(new Request('http://mokup.local/mw'))
    await expect(mwResponse.text()).resolves.toBe('ok')
    expect(preCalled).toBe(true)
    expect(postCalled).toBe(true)

    const binResponse = await app.fetch(new Request('http://mokup.local/binary-uint'))
    expect(binResponse.headers.get('content-type')).toBe('application/custom')
    const buffer = new Uint8Array(await binResponse.arrayBuffer())
    expect(Array.from(buffer)).toEqual([1, 2])
  })
})
