import type { HttpHandler } from '@mokup/runtime/http'
import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { createServer, request as nodeRequest } from 'node:http'
import { parseRouteTemplate } from '@mokup/runtime'
import { createMockSession, delay, http, HttpResponse, networkError, passthrough } from '@mokup/runtime/http'
import { Hono } from '@mokup/shared/hono'
import { describe, expect, it, vi } from 'vitest'
import { createHonoApp, createMiddleware } from '../src/middleware'

async function fixture(handlers: HttpHandler[] = [], before?: () => Promise<void>, hono?: Hono) {
  const session = createMockSession(...handlers)
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const downstream = vi.fn<(req: IncomingMessage) => void>()
  const incoming: IncomingMessage[] = []
  const middleware = createMiddleware(() => hono ?? null, logger, hono ? {} : { getSession: () => session })
  const server = createServer(async (req, res) => {
    incoming.push(req)
    await before?.()
    await middleware(req, res, () => {
      downstream(req)
      res.setHeader('x-downstream', 'yes')
      req.pipe(res)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    session,
    logger,
    downstream,
    incoming,
    async close() {
      await session.dispose()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}

describe('Connect HTTP session dispatch', () => {
  it('forwards mounted session misses with replayable bodies and preserves deliberate 404 responses', async () => {
    const parsed = parseRouteTemplate('/intentional')
    const child = createHonoApp([{
      method: 'GET',
      file: 'intentional.get.ts',
      template: parsed.template,
      tokens: parsed.tokens,
      score: parsed.score,
      handler: () => new Response('intentional', { status: 404, headers: { 'x-intentional': 'yes' } }),
    }])
    child.mockSession.use(http.post('/reading', async ({ request }) => {
      expect(await request.text()).toBe('original')
      return passthrough()
    }))
    const parent = new Hono().route('/mount', child)
    parent.get('/mount/native', c => c.text('native 404', 404))
    const app = await fixture([], undefined, parent)
    child.mockSession.use(http.get(`${app.url}/mount/absolute`, ({ request }) => HttpResponse.text(request.url)))
    try {
      expect(await (await fetch(`${app.url}/mount/absolute`)).text()).toBe(`${app.url}/mount/absolute`)
      const request = await fetch(`${app.url}/mount/reading`, { method: 'POST', body: 'original' })
      expect(request.headers.get('x-downstream')).toBe('yes')
      expect(await request.text()).toBe('original')
      const intentional = await fetch(`${app.url}/mount/intentional`)
      expect(intentional.status).toBe(404)
      expect(intentional.headers.get('x-intentional')).toBe('yes')
      expect(await intentional.text()).toBe('intentional')
      expect(await (await fetch(`${app.url}/mount/native`)).text()).toBe('native 404')
      expect(app.downstream).toHaveBeenCalledOnce()
    }
    finally {
      await child.mockSession.dispose()
      await app.close()
    }
  })
  it('dispatches native absolute and relative handlers with no file routes', async () => {
    const app = await fixture()
    app.session.use(http.get(`${app.url}/native/:id`, ({ params, request }) => HttpResponse.json({ id: params.id, url: request.url })))
    app.session.use(http.get('/relative', () => HttpResponse.text('relative')))
    try {
      expect(await (await fetch(`${app.url}/native/42?flag=yes`)).json()).toEqual({ id: '42', url: `${app.url}/native/42?flag=yes` })
      expect(await (await fetch(`${app.url}/relative`)).text()).toBe('relative')
      expect(app.downstream).not.toHaveBeenCalled()
    }
    finally {
      await app.close()
    }
  })

  it.each(['unmatched', 'passthrough', 'predicate', 'undefined'] as const)('retains binary request bytes for a %s request', async (mode) => {
    const body = Buffer.from(Array.from({ length: 150_000 }, (_, index) => index % 256))
    const seen: Buffer[] = []
    const handlers = mode === 'unmatched'
      ? []
      : [http.post(mode === 'predicate'
          ? async ({ request }) => {
            seen.push(Buffer.from(await request.arrayBuffer()))
            return false
          }
          : '/body', async ({ request }) => {
          seen.push(Buffer.from(await request.arrayBuffer()))
          return mode === 'passthrough' ? passthrough() : undefined
        })]
    const app = await fixture(handlers)
    try {
      const response = await fetch(`${app.url}/body`, { method: 'POST', body })
      expect(response.headers.get('x-downstream')).toBe('yes')
      expect(Buffer.from(await response.arrayBuffer())).toEqual(body)
      if (mode !== 'unmatched') {
        expect(seen).toEqual([body])
      }
      expect(app.downstream).toHaveBeenCalledOnce()
      expect(app.downstream.mock.calls[0]?.[0]).toBe(app.incoming[0])
      expect(app.logger.error).not.toHaveBeenCalled()
    }
    finally {
      await app.close()
    }
  })

  it('retains an already buffered body after upstream asynchronous middleware', async () => {
    const app = await fixture([http.post('/body', async ({ request }) => {
      expect(await request.text()).toBe('already buffered')
      return passthrough()
    })], () => delay(20))
    try {
      expect(await (await fetch(`${app.url}/body`, { method: 'POST', body: 'already buffered' })).text()).toBe('already buffered')
      expect(app.logger.error).not.toHaveBeenCalled()
    }
    finally {
      await app.close()
    }
  })

  it('retains chunked uploads and emits ordered miss events with one requestId', async () => {
    const app = await fixture()
    const events: { type: string, id: string }[] = []
    for (const type of ['request:start', 'request:unhandled', 'response:bypass', 'request:end'] as const) {
      app.session.events.on(type, event => events.push({ type, id: event.requestId }))
    }
    try {
      const echoed = await new Promise<string>((resolve, reject) => {
        const req = nodeRequest(`${app.url}/upload`, { method: 'POST' }, (res) => {
          const chunks: Buffer[] = []
          res.on('data', chunk => chunks.push(chunk))
          res.once('end', () => resolve(Buffer.concat(chunks).toString()))
          res.once('error', reject)
        })
        req.once('error', reject)
        req.write('first')
        setTimeout(() => req.end('second'), 10)
      })
      expect(echoed).toBe('firstsecond')
      expect(events.map(event => event.type)).toEqual(['request:start', 'request:unhandled', 'response:bypass', 'request:end'])
      expect(new Set(events.map(event => event.id)).size).toBe(1)
      expect(app.logger.error).not.toHaveBeenCalled()
    }
    finally {
      await app.close()
    }
  })

  it('applies warn, callback and error policies to misses', async () => {
    const app = await fixture()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const callback = vi.fn()
    try {
      app.session.setOnUnhandled('warn')
      expect((await fetch(`${app.url}/warn`)).status).toBe(200)
      expect(warning).toHaveBeenCalledExactlyOnceWith(`[mokup] Unhandled request: GET ${app.url}/warn`)
      app.session.setOnUnhandled(callback)
      await fetch(`${app.url}/callback`)
      expect(callback).toHaveBeenCalledOnce()
      app.session.setOnUnhandled('error')
      expect((await fetch(`${app.url}/error`)).status).toBe(500)
      expect(app.downstream).toHaveBeenCalledTimes(2)
    }
    finally {
      warning.mockRestore()
      await app.close()
    }
  })

  it('closing a session releases a body reader waiting for an unfinished upload', async () => {
    const app = await fixture()
    const req = nodeRequest(`${app.url}/upload`, { method: 'POST' })
    const closed = new Promise<void>(resolve => req.once('close', resolve))
    req.on('error', () => {})
    req.write('incomplete')
    try {
      await vi.waitFor(() => expect(app.incoming[0]?.listenerCount('readable')).toBe(1))
      await app.session.dispose()
      expect(app.session.signal.aborted).toBe(true)
      await vi.waitFor(() => expect(app.incoming[0]?.listenerCount('readable')).toBe(0))
      expect(app.downstream).not.toHaveBeenCalled()
    }
    finally {
      req.destroy()
      await closed
      await app.close()
    }
  })

  it('turns an intentional network error into a failed transport without forwarding the request', async () => {
    const app = await fixture([http.get('/error', networkError)])
    try {
      await expect(fetch(`${app.url}/error`)).rejects.toThrow('fetch failed')
      expect(app.downstream).not.toHaveBeenCalled()
      expect(app.logger.error).not.toHaveBeenCalled()
    }
    finally {
      await app.close()
    }
  })
})
