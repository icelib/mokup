import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RouteTable } from '../src/shared/types'
import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { createHonoApp, createMiddleware } from '@mokup/core'
import { parseRouteTemplate } from '@mokup/runtime'
import { Hono, PatternRouter } from '@mokup/shared/hono'
import { describe, expect, it, vi } from 'vitest'

function createRouteTable(): RouteTable {
  const parsed = parseRouteTemplate('/users/[id]')
  return [
    {
      file: 'users/[id].get.ts',
      template: parsed.template,
      method: 'GET',
      tokens: parsed.tokens,
      score: parsed.score,
      handler: c => ({ id: c.req.param('id') ?? null }),
    },
  ]
}

function createMatchResult(method: string, path: string): ReturnType<Hono['router']['match']> {
  const app = new Hono({ router: new PatternRouter() })
  app.on(method, path, c => c.body(null))
  return app.router.match(method, path)
}

describe('dev middleware params', () => {
  it('passes params to handlers', async () => {
    const routes = createRouteTable()
    const app = createHonoApp(routes)
    const middleware = createMiddleware(() => app, console)

    const req = new EventEmitter() as IncomingMessage
    req.url = '/users/123'
    req.method = 'GET'
    req.headers = {}

    const state = {
      body: '',
      statusCode: 0,
      headers: {} as Record<string, string>,
      writableEnded: false,
    }
    const res = {
      setHeader: (name: string, value: string) => {
        state.headers[name] = value
      },
      getHeader: (name: string) => state.headers[name],
      end: (chunk?: string | Uint8Array) => {
        if (typeof chunk === 'undefined') {
          state.body = ''
        }
        else {
          state.body = typeof chunk === 'string'
            ? chunk
            : Buffer.from(chunk).toString('utf8')
        }
        state.writableEnded = true
      },
      get statusCode() {
        return state.statusCode
      },
      set statusCode(value: number) {
        state.statusCode = value
      },
      get writableEnded() {
        return state.writableEnded
      },
    } as unknown as ServerResponse

    const promise = middleware(req, res, () => {
      res.statusCode = 404
      res.end('not found')
    })
    req.emit('end')
    await promise

    const data = JSON.parse(state.body)
    expect(data).toEqual({ id: '123' })
  })

  it('passes through when app is missing or has no match', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const missingApp = createMiddleware(() => null, logger)

    const req = new EventEmitter() as IncomingMessage
    req.url = '/nope'
    req.method = 'GET'
    req.headers = {}

    const res = { writableEnded: false } as ServerResponse
    const next = vi.fn()

    await missingApp(req, res, next)
    expect(next).toHaveBeenCalled()

    const routes = createRouteTable()
    const app = createHonoApp(routes)
    const middleware = createMiddleware(() => app, logger)

    const unmatchedReq = new EventEmitter() as IncomingMessage
    unmatchedReq.url = '/other'
    unmatchedReq.method = 'GET'
    unmatchedReq.headers = {}

    const nextUnmatched = vi.fn()
    await middleware(unmatchedReq, res, nextUnmatched)
    expect(nextUnmatched).toHaveBeenCalled()
  })

  it('handles handler errors and returns 500', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const app = {
      router: {
        match: () => createMatchResult('GET', '/boom'),
      },
      fetch: async () => {
        throw new Error('boom')
      },
    } as never
    const middleware = createMiddleware(() => app, logger)

    const req = new EventEmitter() as IncomingMessage
    req.url = '/boom'
    req.method = 'GET'
    req.headers = {}

    const state = {
      body: '',
      statusCode: 0,
      headers: {} as Record<string, string>,
      writableEnded: false,
      headersSent: false,
    }
    const res = {
      setHeader: (name: string, value: string) => {
        state.headers[name] = value
        state.headersSent = true
      },
      getHeader: (name: string) => state.headers[name],
      end: (chunk?: string | Uint8Array) => {
        if (typeof chunk === 'undefined') {
          state.body = ''
        }
        else {
          state.body = typeof chunk === 'string'
            ? chunk
            : Buffer.from(chunk).toString('utf8')
        }
        state.writableEnded = true
      },
      get statusCode() {
        return state.statusCode
      },
      set statusCode(value: number) {
        state.statusCode = value
      },
      get writableEnded() {
        return state.writableEnded
      },
      get headersSent() {
        return state.headersSent
      },
    } as unknown as ServerResponse

    const promise = middleware(req, res, () => undefined)
    req.emit('end')
    await promise

    expect(state.statusCode).toBe(500)
    expect(state.body).toBe('Mock handler error')
    expect(logger.error).toHaveBeenCalled()
  })

  it('normalizes handler values and applies overrides', async () => {
    const parsed = parseRouteTemplate('/payload')
    const calls: string[] = []
    const app = createHonoApp([
      {
        file: 'payload.post.ts',
        template: parsed.template,
        method: 'POST',
        tokens: parsed.tokens,
        score: parsed.score,
        handler: () => undefined,
        status: 201,
        headers: { 'x-test': '1' },
        delay: 1,
        middlewares: [
          {
            handle: async (_c, next) => {
              calls.push('pre')
              await next()
              return { res: new Response('mw') }
            },
            source: 'pre',
            index: 0,
            position: 'pre',
          },
          {
            handle: async (_c, next) => {
              calls.push('post')
              await next()
            },
            source: 'post',
            index: 1,
            position: 'post',
          },
        ],
      },
    ])

    const response = await app.fetch(new Request('http://mokup.local/payload', { method: 'POST' }))

    expect(response.status).toBe(201)
    expect(response.headers.get('x-test')).toBe('1')
    await expect(response.text()).resolves.toBe('')
    expect(calls).toEqual(['pre', 'post'])
  })

  it('handles text and binary handler values', async () => {
    const textParsed = parseRouteTemplate('/text')
    const binaryParsed = parseRouteTemplate('/binary')
    const app = createHonoApp([
      {
        file: 'text.get.ts',
        template: textParsed.template,
        method: 'GET',
        tokens: textParsed.tokens,
        score: textParsed.score,
        handler: () => 'ok',
      },
      {
        file: 'binary.get.ts',
        template: binaryParsed.template,
        method: 'GET',
        tokens: binaryParsed.tokens,
        score: binaryParsed.score,
        handler: () => new Uint8Array([1, 2, 3]),
      },
    ])

    const textResponse = await app.fetch(new Request('http://mokup.local/text'))
    expect(await textResponse.text()).toBe('ok')

    const binaryResponse = await app.fetch(new Request('http://mokup.local/binary'))
    expect(binaryResponse.headers.get('content-type')).toBe('application/octet-stream')
    expect(Array.from(new Uint8Array(await binaryResponse.arrayBuffer()))).toEqual([1, 2, 3])
  })

  it('builds requests from node streams and headers', async () => {
    const match = vi.fn<Hono['router']['match']>().mockReturnValue(createMatchResult('POST', '/payload'))
    const received: { body?: string, header?: string } = {}
    const app = {
      router: { match },
      fetch: async (request: Request) => {
        received.body = await request.text()
        received.header = request.headers.get('x-test') ?? ''
        return new Response(null, { status: 204 })
      },
    } as never
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const middleware = createMiddleware(() => app, logger)

    const req = new EventEmitter() as IncomingMessage
    req.url = '/payload'
    req.method = 'POST'
    req.headers = { 'x-test': ['a', 'b'], 'x-skip': undefined }

    const state = {
      statusCode: 0,
      ended: false,
    }
    const res = {
      setHeader: vi.fn(),
      end: () => {
        state.ended = true
      },
      get statusCode() {
        return state.statusCode
      },
      set statusCode(value: number) {
        state.statusCode = value
      },
      get writableEnded() {
        return state.ended
      },
    } as unknown as ServerResponse

    const promise = middleware(req, res, vi.fn())
    req.emit('data', 'hello')
    req.emit('end')
    await promise

    expect(match).toHaveBeenCalledWith('POST', '/payload')
    expect(received.body).toBe('hello')
    expect(received.header).toBe('a,b')
    expect(state.ended).toBe(true)
    expect(logger.info).toHaveBeenCalled()
  })

  it('checks explicit HEAD routes before falling back to GET routes', async () => {
    const match = vi.fn<Hono['router']['match']>()
      .mockReturnValueOnce([[]])
      .mockReturnValue(createMatchResult('GET', '/head'))
    const app = {
      router: { match },
      fetch: async () => new Response(null),
    } as never
    const middleware = createMiddleware(() => app, console)

    const req = new EventEmitter() as IncomingMessage
    req.url = '/head'
    req.method = 'HEAD'
    req.headers = {}

    const res = { writableEnded: false, setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse
    const promise = middleware(req, res, vi.fn())
    req.emit('end')
    await promise

    expect(match.mock.calls).toEqual([['HEAD', '/head'], ['GET', '/head']])
  })

  it('supports root and optional catchall routes', async () => {
    const rootParsed = parseRouteTemplate('/')
    const optionalParsed = parseRouteTemplate('/docs/[[...slug]]')
    const catchallParsed = parseRouteTemplate('/files/[...path]')

    const app = createHonoApp([
      {
        file: 'root.get.ts',
        template: rootParsed.template,
        method: 'GET',
        tokens: rootParsed.tokens,
        score: rootParsed.score,
        handler: () => 'root',
      },
      {
        file: 'optional.get.ts',
        template: optionalParsed.template,
        method: 'GET',
        tokens: optionalParsed.tokens,
        score: optionalParsed.score,
        handler: () => 'optional',
      },
      {
        file: 'catchall.get.ts',
        template: catchallParsed.template,
        method: 'GET',
        tokens: catchallParsed.tokens,
        score: catchallParsed.score,
        handler: () => 'catchall',
      },
    ])

    const root = await app.fetch(new Request('http://mokup.local/'))
    await expect(root.text()).resolves.toBe('root')

    const optional = await app.fetch(new Request('http://mokup.local/docs'))
    await expect(optional.text()).resolves.toBe('optional')

    const catchall = await app.fetch(new Request('http://mokup.local/files/a/b'))
    await expect(catchall.text()).resolves.toBe('catchall')
  })

  it('handles response handlers, array buffers, and normal middlewares', async () => {
    const responseParsed = parseRouteTemplate('/response')
    const bufferParsed = parseRouteTemplate('/buffer')
    const app = createHonoApp([
      {
        file: 'response.get.ts',
        template: responseParsed.template,
        method: 'GET',
        tokens: responseParsed.tokens,
        score: responseParsed.score,
        handler: () => new Response('ok'),
        middlewares: [
          {
            handle: async (_c, next) => next(),
            source: 'normal',
            index: 0,
            position: 'normal',
          },
        ],
      },
      {
        file: 'buffer.get.ts',
        template: bufferParsed.template,
        method: 'GET',
        tokens: bufferParsed.tokens,
        score: bufferParsed.score,
        handler: () => new Uint8Array([4, 5, 6]).buffer,
      },
    ])

    const response = await app.fetch(new Request('http://mokup.local/response'))
    expect(await response.text()).toBe('ok')

    const bufferResponse = await app.fetch(new Request('http://mokup.local/buffer'))
    expect(bufferResponse.headers.get('content-type')).toBe('application/octet-stream')
    expect(Array.from(new Uint8Array(await bufferResponse.arrayBuffer()))).toEqual([4, 5, 6])
  })

  it('covers response resolution and header normalization branches', async () => {
    const mwParsed = parseRouteTemplate('/mw')
    const objParsed = parseRouteTemplate('/obj')
    const binaryParsed = parseRouteTemplate('/binary-custom')
    const dataParsed = parseRouteTemplate('/data')
    const statusParsed = parseRouteTemplate('/status')

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
            handle: async () => new Response('mw'),
            source: 'mw',
            index: 0,
            position: 'pre',
          },
        ],
      },
      {
        file: 'obj.get.ts',
        template: objParsed.template,
        method: 'GET',
        tokens: objParsed.tokens,
        score: objParsed.score,
        handler: () => 'ok',
        middlewares: [
          {
            handle: async () => ({ res: new Response('obj') }),
            source: 'mw',
            index: 0,
            position: 'post',
          },
        ],
      },
      {
        file: 'binary.get.ts',
        template: binaryParsed.template,
        method: 'GET',
        tokens: binaryParsed.tokens,
        score: binaryParsed.score,
        handler: (c) => {
          c.header('content-type', 'application/custom')
          return new Uint8Array([9])
        },
      },
      {
        file: 'data.get.ts',
        template: dataParsed.template,
        method: 'GET',
        tokens: dataParsed.tokens,
        score: dataParsed.score,
        handler: { ok: true },
      },
      {
        file: 'status.get.ts',
        template: statusParsed.template,
        method: 'GET',
        tokens: statusParsed.tokens,
        score: statusParsed.score,
        handler: (c) => {
          c.status(201)
          return undefined
        },
      },
    ])

    const mwResponse = await app.fetch(new Request('http://mokup.local/mw'))
    await expect(mwResponse.text()).resolves.toBe('mw')

    const objResponse = await app.fetch(new Request('http://mokup.local/obj'))
    await expect(objResponse.text()).resolves.toBe('obj')

    const binaryResponse = await app.fetch(new Request('http://mokup.local/binary-custom'))
    expect(binaryResponse.headers.get('content-type')).toBe('application/custom')

    const dataResponse = await app.fetch(new Request('http://mokup.local/data'))
    await expect(dataResponse.json()).resolves.toEqual({ ok: true })

    const statusResponse = await app.fetch(new Request('http://mokup.local/status'))
    expect(statusResponse.status).toBe(201)
  })

  it('supports empty token routes', async () => {
    const app = createHonoApp([
      {
        file: 'root.get.ts',
        template: '/',
        method: 'GET',
        tokens: [],
        score: [],
        handler: () => 'root',
      },
    ])

    const response = await app.fetch(new Request('http://mokup.local/'))
    await expect(response.text()).resolves.toBe('root')
  })

  it('normalizes missing methods and skips bodies on GET', async () => {
    const match = vi.fn<Hono['router']['match']>().mockReturnValue(createMatchResult('GET', '/'))
    const received: { body?: string, method?: string } = {}
    const app = {
      router: { match },
      fetch: async (request: Request) => {
        received.body = await request.text()
        received.method = request.method
        return new Response(null, { status: 204 })
      },
    } as never
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const middleware = createMiddleware(() => app, logger)

    const req = new EventEmitter() as IncomingMessage
    req.url = undefined
    req.method = undefined
    req.headers = {}

    const state = { ended: false }
    const res = {
      setHeader: vi.fn(),
      end: () => {
        state.ended = true
      },
      get statusCode() {
        return 204
      },
      set statusCode(_value: number) {

      },
      get writableEnded() {
        return state.ended
      },
    } as unknown as ServerResponse

    const promise = middleware(req, res, vi.fn())
    req.emit('data', 'payload')
    req.emit('end')
    await promise

    expect(received.method).toBe('GET')
    expect(received.body).toBe('')
    expect(state.ended).toBe(true)
  })

  it('handles errors after headers are sent', async () => {
    const app = {
      router: { match: () => createMatchResult('GET', '/boom') },
      fetch: async () => {
        throw new Error('boom')
      },
    } as never
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const middleware = createMiddleware(() => app, logger)

    const req = new EventEmitter() as IncomingMessage
    req.url = '/boom'
    req.method = 'GET'
    req.headers = {}

    const res = {
      headersSent: true,
      setHeader: vi.fn(),
      end: vi.fn(),
      get statusCode() {
        return 0
      },
      set statusCode(_value: number) {

      },
      get writableEnded() {
        return false
      },
    } as unknown as ServerResponse

    const promise = middleware(req, res, vi.fn())
    req.emit('end')
    await promise
    expect(res.setHeader).not.toHaveBeenCalled()
    expect(res.end).toHaveBeenCalledWith('Mock handler error')
  })

  it('skips sending responses when the stream is already ended', async () => {
    const app = {
      router: { match: () => createMatchResult('POST', '/payload') },
      fetch: async () => new Response('ok'),
    } as never
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const middleware = createMiddleware(() => app, logger)

    const req = new EventEmitter() as IncomingMessage
    req.url = '/payload'
    req.method = 'POST'
    req.headers = { 'x-test': 'value', 'x-omit': undefined }

    const res = {
      setHeader: vi.fn(),
      end: vi.fn(),
      get writableEnded() {
        return true
      },
    } as unknown as ServerResponse

    const promise = middleware(req, res, vi.fn())
    req.emit('data', new Uint8Array([1, 2, 3]))
    req.emit('data', 2 as any)
    req.emit('end')
    await promise

    expect(res.setHeader).not.toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
  })
})
