import type { Hono as HonoApp } from '@mokup/shared/hono'
import type { AddressInfo } from 'node:net'
import type { ResolvedRoute } from '../src/shared/types'
import { createServer, request } from 'node:http'
import { parseRouteTemplate } from '@mokup/runtime'
import { Hono } from '@mokup/shared/hono'
import { describe, expect, it, vi } from 'vitest'
import { createHonoApp, createMiddleware } from '../src/middleware'

function route(method: 'GET' | 'HEAD', path: string, handler: ResolvedRoute['handler'], extra: Partial<ResolvedRoute> = {}): ResolvedRoute {
  const parsed = parseRouteTemplate(path)
  return { method, file: `${path}.${method}.ts`, template: parsed.template, tokens: parsed.tokens, score: parsed.score, handler, ...extra }
}

async function withServer(app: HonoApp, run: (read: (method: string, path: string) => Promise<{
  status: number
  headers: Record<string, string | string[] | undefined>
  rawHeaders: string[]
  body: string
}>) => Promise<void>) {
  const middleware = createMiddleware(() => app, { info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  const server = createServer((req, res) => {
    void middleware(req, res, () => {
      res.statusCode = 209
      res.end('next')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const read = (method: string, path: string) => new Promise<{
      status: number
      headers: Record<string, string | string[] | undefined>
      rawHeaders: string[]
      body: string
    }>((resolve, reject) => {
      const req = request({ method, path, port: (server.address() as AddressInfo).port, hostname: '127.0.0.1' }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('error', reject)
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, rawHeaders: res.rawHeaders, body }))
      })
      req.on('error', reject)
      req.setTimeout(2000, () => req.destroy(new Error('Request timed out')))
      req.end()
    })
    await run(read)
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

describe('core HEAD routing', () => {
  it('selects explicit HEAD chains and keeps GET fallbacks with native HTTP framing', async () => {
    const app = createHonoApp([
      route('GET', '/both', () => new Response('get', { headers: { 'x-route': 'handler' } }), { status: 201, headers: { 'x-route': 'get', 'content-length': '3' } }),
      route('HEAD', '/both', () => new Response('head', { headers: { 'x-route': 'handler' } }), { status: 202, headers: { 'x-route': 'head', 'content-length': '4' } }),
      route('HEAD', '/only', c => new Response(c.req.method, { headers: { 'x-method': c.req.method } })),
      route('GET', '/fallback', c => new Response('fallback', { headers: { 'x-method': c.req.method, 'content-length': '8' } })),
    ])
    expect(app).toBeInstanceOf(Hono)
    await withServer(app, async (read) => {
      expect(await read('HEAD', '/both')).toMatchObject({ status: 202, headers: { 'x-route': 'head', 'content-length': '4' }, body: '' })
      expect(await read('GET', '/both')).toMatchObject({ status: 201, headers: { 'x-route': 'get' }, body: 'get' })
      expect(await read('HEAD', '/only')).toMatchObject({ status: 200, headers: { 'x-method': 'HEAD' }, body: '' })
      expect(await read('GET', '/only')).toMatchObject({ status: 209, body: 'next' })
      expect(await read('HEAD', '/fallback')).toMatchObject({ status: 200, headers: { 'x-method': 'HEAD', 'content-length': '8' }, body: '' })
    })
  })

  it('recognizes guards through multiple custom-error Hono mounts before Connect dispatch', async () => {
    const headHandler = vi.fn(() => 'head')
    const child = createHonoApp([
      route('HEAD', '/only/[id]', headHandler, { headers: { 'x-route': 'head' } }),
      route('HEAD', '/error', () => { throw new Error('head-error') }),
    ])
    child.onError((error, c) => c.text(error.message, 418, { 'x-error': 'child' }))
    const middle = new Hono()
    middle.onError((_error, c) => c.text('middle', 500))
    middle.route('/child', child)
    const parent = new Hono()
    parent.route('/mounted', middle)
    await withServer(parent, async (read) => {
      expect(await read('GET', '/mounted/child/only/1')).toMatchObject({ status: 209, body: 'next' })
      expect(headHandler).not.toHaveBeenCalled()
      expect(await read('HEAD', '/mounted/child/only/1')).toMatchObject({ status: 200, headers: { 'x-route': 'head' }, body: '' })
      expect(headHandler).toHaveBeenCalledTimes(1)
      expect(await read('HEAD', '/mounted/child/error')).toMatchObject({ status: 418, headers: { 'x-error': 'child' }, body: '' })
    })
  })

  it.each(['HEAD', 'GET'] as const)('cancels a streamed %s response when handling HEAD over native HTTP', async (method) => {
    const cancel = vi.fn()
    const app = createHonoApp([
      route(method, '/stream', () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('payload'))
        },
        cancel,
      }), { headers: { 'content-length': '7' } })),
    ])
    await withServer(app, async (read) => {
      expect(await read('HEAD', '/stream')).toMatchObject({ status: 200, body: '', headers: { 'content-length': '7' } })
      expect(cancel).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps every cookie separate and validates all cookies before committing headers', async () => {
    const cookies = ['session=abc; HttpOnly', 'theme=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT']
    const app = createHonoApp([
      route('GET', '/cookies', () => new Response('ok', { headers: cookies.map<[string, string]>(cookie => ['Set-Cookie', cookie]) })),
      route('GET', '/broken', () => new Response('bad', { status: 201, headers: [
        ['Content-Length', '3'],
        ['Content-Encoding', 'gzip'],
        ['Set-Cookie', cookies[0]!],
        ['Set-Cookie', `invalid=${String.fromCharCode(127)}`],
      ] })),
    ])
    await withServer(app, async (read) => {
      const response = await read('GET', '/cookies')
      expect(response.headers['set-cookie']).toEqual(cookies)
      expect(response.rawHeaders.filter(value => value.toLowerCase() === 'set-cookie')).toHaveLength(2)
      const failed = await read('GET', '/broken')
      expect(failed).toMatchObject({ status: 500, body: 'Mock handler error' })
      expect(failed.headers['set-cookie']).toBeUndefined()
      expect(failed.headers['content-encoding']).toBeUndefined()
      expect(failed.headers['content-length']).not.toBe('3')
      expect((await read('GET', '/cookies')).headers['set-cookie']).toEqual(cookies)
    })
  })

  it.each([204, 205, 304])('applies status %i over a payload without sending a body or losing cookies', async (status) => {
    const cookies = ['session=abc; HttpOnly', 'theme=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT']
    const app = createHonoApp([
      route('GET', '/bodyless', () => new Response('payload', { headers: [
        ['Content-Length', '7'],
        ...cookies.map<[string, string]>(cookie => ['Set-Cookie', cookie]),
      ] }), { status }),
    ])
    await withServer(app, async (read) => {
      const response = await read('GET', '/bodyless')
      expect(response.status).toBe(status)
      expect(response.body).toBe('')
      expect(response.headers['set-cookie']).toEqual(cookies)
      if (status === 304) {
        expect(response.headers['content-length']).toBe('7')
      }
      else {
        expect(response.headers['content-length']).not.toBe('7')
        expect(response.headers['transfer-encoding']).toBeUndefined()
      }
    })
  })
})
