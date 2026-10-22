import type { Context } from '@mokup/shared/hono'
import type { ResolvedHttpRoute } from '../src/resolved-handlers'
import { Hono } from '@mokup/shared/hono'
import { describe, expect, it, vi } from 'vitest'
import { createMockSession, http, HttpResponse } from '../src/http'
import { captureResponseCookies, getResponseCookies } from '../src/http/response-cookies'
import { compileResolvedRouteHandlers, createResolvedRouteApp } from '../src/resolved-handlers'
import { parseRouteTemplate } from '../src/router'

function route(path: string, handler: (context: Context) => unknown, extra: Partial<ResolvedHttpRoute> = {}): ResolvedHttpRoute {
  return { method: 'GET', tokens: parseRouteTemplate(path).tokens, handler, ...extra }
}

describe('resolved file-route HTTP sessions', () => {
  it.each(['GET', 'HEAD'])('retains hidden response cookies during scoped %s dispatch', async (method) => {
    const cookies = ['session=one; HttpOnly', 'theme=dark']
    const app = createResolvedRouteApp([route('/cookies', () => {
      const response = new Response('body')
      captureResponseCookies(response, cookies.map(cookie => ['set-cookie', cookie]))
      return response
    })])
    try {
      const response = await app.request('/cookies', { method })
      expect(getResponseCookies(response)).toEqual(cookies)
      expect(await response.text()).toBe(method === 'HEAD' ? '' : 'body')
    }
    finally {
      await app.mockSession.dispose()
    }
  })
  it('keeps controls, original URLs and parent context when mounted at multiple dynamic scopes', async () => {
    const app = createResolvedRouteApp([route('/users/[id]', c => c.json({
      params: c.req.param(),
      url: c.req.url,
      label: c.get('label'),
    }))])
    const parent = new Hono()
    parent.use('*', async (c, next) => {
      c.set('label', 'parent')
      await next()
    })
    parent.route('/teams/:tenant', app)
    parent.route('/secondary', app)
    parent.post('/teams/:tenant/native', async c => c.text(await c.req.text()))
    const events = vi.fn()
    app.mockSession.events.on('request:start', events)
    app.mockSession.use(http.get('/extra', ({ request }) => HttpResponse.text(request.url), { once: true }))
    try {
      const response = await parent.request('/teams/a/users/42?q=original')
      expect(await response.json()).toEqual({ params: { tenant: 'a', id: '42' }, url: 'http://localhost/teams/a/users/42?q=original', label: 'parent' })
      expect(await (await parent.request('/teams/a/extra')).text()).toBe('http://localhost/teams/a/extra')
      expect((await parent.request('/secondary/extra')).status).toBe(404)
      app.mockSession.restoreHandlers()
      expect(await (await parent.request('/secondary/extra')).text()).toBe('http://localhost/secondary/extra')
      const body = new Request('http://localhost/teams/a/native', { method: 'POST', body: 'untouched' })
      expect(await (await parent.fetch(body)).text()).toBe('untouched')
      expect(events).toHaveBeenCalledTimes(5)
      app.mockSession.resetHandlers()
      expect((await parent.request('/teams/a/extra')).status).toBe(404)
    }
    finally {
      await app.mockSession.dispose()
    }
  })

  it('updates the baseline and retains live cancellation after a mounted app refresh', async () => {
    const cancel = vi.fn()
    const app = createResolvedRouteApp([route('/value', () => 'old')])
    const parent = new Hono().route('/mount/:tenant', app)
    try {
      createResolvedRouteApp([route('/value', () => 'new'), route('/stream', () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('first')) },
        cancel,
      })))], { session: app.mockSession })
      expect(await (await parent.request('/mount/team/value')).text()).toBe('new')
      const response = await parent.request('/mount/team/stream')
      const reader = response.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
      await app.mockSession.dispose()
      await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
      expect(cancel).toHaveBeenCalledOnce()
    }
    finally {
      await app.mockSession.dispose()
    }
  })
  it('snapshots routing and response metadata while preserving handler state', async () => {
    const headers = { 'x-file': 'original' }
    const middleware = { position: 'pre' as const, handle: async (c: Context, next: () => Promise<void>) => {
      await next()
      c.header('x-middleware', 'original')
    } }
    const definition = route('/original', () => 'original', { headers, middlewares: [middleware] })
    const app = createResolvedRouteApp([definition])
    definition.method = 'POST'
    definition.tokens[0] = { type: 'static', value: 'changed' }
    definition.handler = () => 'changed'
    headers['x-file'] = 'changed'
    middleware.handle = async (c) => {
      c.header('x-middleware', 'changed')
    }
    try {
      const response = await app.request('/original')
      expect(await response.text()).toBe('original')
      expect(response.headers.get('x-file')).toBe('original')
      expect(response.headers.get('x-middleware')).toBe('original')
      expect((await app.request('/changed')).status).toBe(404)
    }
    finally {
      await app.mockSession.dispose()
    }
  })
  it('preserves transport bindings for Hono compatibility handlers', async () => {
    const app = createResolvedRouteApp([route('/bindings', c => c.json(c.env))])
    try {
      const response = await app.fetch(new Request('https://example.test/bindings'), { name: 'worker' })
      expect(await response.json()).toEqual({ name: 'worker' })
    }
    finally {
      await app.mockSession.dispose()
    }
  })
  it('compiles file params and middleware into native handler definitions', async () => {
    const calls: string[] = []
    const definitions = compileResolvedRouteHandlers([route('/users/[id]', c => ({ id: c.req.param('id') }), {
      headers: { 'x-file': 'yes' },
      middlewares: [{ position: 'pre', handle: async (c, next) => {
        calls.push('before')
        await next()
        c.header('x-middleware', 'yes')
        calls.push('after')
      } }],
    })])
    const session = createMockSession(...definitions)
    const match = vi.fn()
    session.events.on('request:match', match)
    try {
      const response = await session.handle(new Request('https://example.test/users/a%20b'))
      expect(await response?.json()).toEqual({ id: 'a b' })
      expect(response?.headers.get('x-file')).toBe('yes')
      expect(response?.headers.get('x-middleware')).toBe('yes')
      expect(calls).toEqual(['before', 'after'])
      expect(match.mock.calls[0]?.[0].handler).toBe(definitions[0])
    }
    finally {
      await session.dispose()
    }
  })

  it('applies shared controls to Fetch dispatch including URLs absent from files', async () => {
    const app = createResolvedRouteApp([route('/users/[id]', c => c.text(c.req.param('id')!))])
    const events: string[] = []
    app.mockSession.events.on('request:start', event => events.push(`start:${event.requestId}`))
    app.mockSession.events.on('request:end', event => events.push(`end:${event.requestId}`))
    app.mockSession.use(http.get('/extra', () => HttpResponse.text('override'), { once: true }))
    try {
      expect(await (await app.request('/extra')).text()).toBe('override')
      expect((await app.request('/extra')).status).toBe(404)
      app.mockSession.restoreHandlers()
      expect(await (await app.request('/extra')).text()).toBe('override')
      app.mockSession.resetHandlers()
      expect((await app.request('/extra')).status).toBe(404)
      expect(await (await app.request('/users/42')).text()).toBe('42')
      expect(events).toHaveLength(10)
      for (let index = 0; index < events.length; index += 2) {
        expect(events[index + 1]).toBe(events[index]?.replace('start:', 'end:'))
      }
    }
    finally {
      await app.mockSession.dispose()
    }
  })

  it('keeps temporary once state across refreshes and resets to the latest file definitions', async () => {
    const app = createResolvedRouteApp([route('/version', () => 'old')])
    const session = app.mockSession
    const override = http.get('/version', () => HttpResponse.text('once'), { once: true })
    session.use(override)
    try {
      expect(await (await app.request('/version')).text()).toBe('once')
      const refreshed = createResolvedRouteApp([route('/version', () => 'new')], { session })
      expect(refreshed.mockSession).toBe(session)
      expect(session.listHandlers()[0]).toBe(override)
      expect(await (await refreshed.request('/version')).text()).toBe('new')
      const fork = session.fork()
      try {
        fork.resetHandlers()
        expect(await (await fork.handle(new Request('https://example.test/version')))?.text()).toBe('new')
      }
      finally {
        await fork.dispose()
      }
      session.restoreHandlers()
      expect(await (await refreshed.request('/version')).text()).toBe('once')
      session.resetHandlers()
      expect(session.listHandlers()).toHaveLength(1)
      expect(await (await refreshed.request('/version')).text()).toBe('new')
    }
    finally {
      await session.dispose()
    }
  })

  it('retains an in-flight file response while publishing a new generation', async () => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const app = createResolvedRouteApp([route('/version', async () => {
      entered()
      await waiting
      return 'old'
    })])
    const response = app.request('/version')
    await started
    try {
      const refreshed = createResolvedRouteApp([route('/version', () => 'new')], { session: app.mockSession })
      expect(await (await refreshed.request('/version')).text()).toBe('new')
      release()
      expect(await (await response).text()).toBe('old')
    }
    finally {
      release()
      await app.mockSession.dispose()
    }
  })

  it('keeps misses readable and honors the shared unhandled policy', async () => {
    const app = createResolvedRouteApp([])
    const request = new Request('https://example.test/missing', { method: 'POST', body: 'untouched' })
    const unhandled = vi.fn()
    app.mockSession.events.on('request:unhandled', unhandled)
    try {
      expect((await app.fetch(request)).status).toBe(404)
      expect(await request.text()).toBe('untouched')
      expect(unhandled).toHaveBeenCalledOnce()
      app.mockSession.setOnUnhandled('error')
      await expect(app.request('/missing')).rejects.toThrow('Unhandled request')
    }
    finally {
      await app.mockSession.dispose()
    }
  })

  it('allows old response streams to finish after their file definition is replaced', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const cancelled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
        value.enqueue(new TextEncoder().encode('first'))
      },
      cancel: cancelled,
    })
    const app = createResolvedRouteApp([route('/stream', () => new Response(stream))])
    try {
      const response = await app.request('/stream')
      const reader = response.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
      createResolvedRouteApp([route('/stream', () => 'new')], { session: app.mockSession })
      controller.enqueue(new TextEncoder().encode('second'))
      controller.close()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('second')
      expect((await reader.read()).done).toBe(true)
      expect(cancelled).not.toHaveBeenCalled()
    }
    finally {
      await app.mockSession.dispose()
    }
  })
})
