import type { Context } from '@mokup/shared/hono'
import type { HttpResolver } from '../src/http'
import type { ResolvedHttpRoute } from '../src/resolved-handlers'
import { Hono } from '@mokup/shared/hono'
import { describe, expect, it, vi } from 'vitest'
import { createMockSession, defineHttpHandler, http, HttpResponse, networkError, passthrough } from '../src/http'
import { captureResponseCookies, getResponseCookies } from '../src/http/response-cookies'
import { compileResolvedRouteHandlers, createResolvedRouteApp } from '../src/resolved-handlers'
import { parseRouteTemplate } from '../src/router'
import { createRuntime, createRuntimeApp } from '../src/runtime'

function route(handler: HttpResolver, extra: Partial<ResolvedHttpRoute> = {}): ResolvedHttpRoute {
  return { method: 'GET', tokens: parseRouteTemplate('/users/[id]').tokens, ...defineHttpHandler(handler), ...extra }
}

const request = () => new Request('https://example.test/users/42')

describe('native file handler execution', () => {
  it('keeps sequence state per session and runs middleware around every step', async () => {
    const calls: string[] = []
    const definitions = compileResolvedRouteHandlers([route(function* ({ request, params, context }) {
      const c = (context as { hono: Context }).hono
      for (let count = 1; count <= 3; count++) {
        yield HttpResponse.json({ count, id: params.id, url: request.url, label: c.get('label') })
      }
    }, {
      status: 202,
      headers: { 'x-file': 'native' },
      middlewares: [{ position: 'pre', handle: async (c, next) => {
        calls.push('before')
        c.set('label', 'middleware')
        await next()
        calls.push('after')
        c.header('x-step', 'yes')
      } }],
    })])
    const session = createMockSession(...definitions)
    const other = session.fork()
    try {
      const responses = await Promise.all([session.handle(request()), session.handle(request()), session.handle(request())])
      const bodies = await Promise.all(responses.map(response => response!.json()))
      expect(bodies.map(body => body.count)).toEqual([1, 2, 3])
      expect(bodies[0]).toEqual({ count: 1, id: '42', url: request().url, label: 'middleware' })
      expect(responses.every(response => response?.status === 202 && response.headers.get('x-step') === 'yes' && response.headers.get('x-file') === 'native')).toBe(true)
      expect(calls.filter(call => call === 'before')).toHaveLength(3)
      expect(calls.filter(call => call === 'after')).toHaveLength(3)
      expect(await (await other.handle(request()))?.json()).toMatchObject({ count: 1 })
      expect(await session.handle(request())).toBeUndefined()
      session.resetHandlers()
      expect(await (await session.handle(request()))?.json()).toMatchObject({ count: 1 })
    }
    finally {
      await Promise.all([session.dispose(), other.dispose()])
    }
  })

  it('executes exactly the selected rule for duplicate native and legacy once definitions', async () => {
    const calls: string[] = []
    const routes = [
      route(() => HttpResponse.text('native'), { once: true, headers: { 'x-rule': 'native' } }),
      { ...route(() => undefined), handlerType: 'hono' as const, once: true, handler: (c: Context) => c.text('legacy'), headers: { 'x-rule': 'legacy' } },
      route(() => HttpResponse.text('fallback'), { headers: { 'x-rule': 'fallback' } }),
    ].map((entry, index) => ({ ...entry, middlewares: [{ position: 'normal' as const, handle: async (_c: Context, next: () => Promise<void>) => {
      calls.push(String(index))
      await next()
    } }] }))
    const app = createResolvedRouteApp(routes)
    try {
      for (const value of ['native', 'legacy', 'fallback', 'fallback']) {
        const response = await app.fetch(request())
        expect(await response.text()).toBe(value)
        expect(response.headers.get('x-rule')).toBe(value)
      }
      expect(calls).toEqual(['0', '1', '2', '2'])
      app.mockSession.restoreHandlers()
      expect(await (await app.fetch(request())).text()).toBe('native')
    }
    finally {
      await app.mockSession.dispose()
    }
  })

  it.each([
    ['undefined', () => undefined, 'fallback'],
    ['passthrough', passthrough, undefined],
    ['networkError', networkError, 'error'],
  ] as const)('preserves %s through header-only middleware', async (_name, resolver, expected) => {
    const session = createMockSession(...compileResolvedRouteHandlers([
      route(resolver, { status: 201, headers: { 'x-file': 'yes' }, middlewares: [{ position: 'normal', handle: async (c, next) => {
        await next()
        c.header('x-middleware', 'yes')
      } }] }),
      route(() => HttpResponse.text('fallback')),
    ]))
    try {
      const response = await session.handle(request())
      if (expected === 'error') {
        expect(response?.type).toBe('error')
        expect(response?.status).toBe(0)
      }
      else {
        expect(await response?.text()).toBe(expected)
      }
    }
    finally {
      await session.dispose()
    }
  })

  it.each(['return', 'assign'] as const)('honors a post-middleware %s response after native fallthrough', async (mode) => {
    const app = createResolvedRouteApp([route(passthrough, { middlewares: [{ position: 'post', handle: async (c, next) => {
      await next()
      if (mode === 'assign') {
        c.res = HttpResponse.text('middleware')
        return
      }
      return HttpResponse.text('middleware')
    } }] })])
    try {
      expect(await (await app.fetch(request())).text()).toBe('middleware')
    }
    finally {
      await app.mockSession.dispose()
    }
  })

  it('keeps an early middleware response and does not advance the resolver', async () => {
    const resolver = vi.fn(() => HttpResponse.text('resolver'))
    const app = createResolvedRouteApp([route(resolver, { middlewares: [{ position: 'pre', handle: c => c.text('early', 401) }] })])
    try {
      const response = await app.fetch(request())
      expect(response.status).toBe(401)
      expect(await response.text()).toBe('early')
      expect(resolver).not.toHaveBeenCalled()
    }
    finally {
      await app.mockSession.dispose()
    }
  })

  it('gives middleware and the standard resolver independent multipart readers', async () => {
    const seen: unknown[] = []
    const app = createResolvedRouteApp([route(async ({ request }) => HttpResponse.text(String((await request.formData()).get('name'))), {
      method: 'POST',
      middlewares: [{ position: 'pre', handle: async (c, next) => {
        seen.push((await c.req.formData()).get('name'))
        await next()
      } }],
    })])
    const form = new FormData()
    form.set('name', 'alice')
    const upload = new Request(request().url, { method: 'POST', body: form })
    try {
      expect(await (await app.fetch(upload)).text()).toBe('alice')
      expect(seen).toEqual(['alice'])
      expect((await upload.formData()).get('name')).toBe('alice')
    }
    finally {
      await app.mockSession.dispose()
    }
  })

  it('retains hidden cookies after native resolution and HEAD reconstruction', async () => {
    const cookies = ['one=1; HttpOnly', 'two=2']
    const app = createResolvedRouteApp([route(() => {
      const response = new Response('body')
      captureResponseCookies(response, cookies.map(cookie => ['set-cookie', cookie]))
      return response
    }, { headers: { 'x-file': 'yes' } })])
    try {
      for (const method of ['GET', 'HEAD']) {
        const response = await app.fetch(new Request(request().url, { method }))
        expect(getResponseCookies(response)).toEqual(cookies)
        expect(await response.text()).toBe(method === 'HEAD' ? '' : 'body')
      }
    }
    finally {
      await app.mockSession.dispose()
    }
  })

  it('closes a native generator, its finalizers and its streaming body with the session', async () => {
    const finalized = vi.fn()
    const closed = vi.fn()
    const cancelled = vi.fn()
    const app = createResolvedRouteApp([route(function* ({ finalize }) {
      finalize(finalized)
      try {
        yield new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode('first')) },
          cancel: cancelled,
        }))
      }
      finally {
        closed()
      }
    })])
    try {
      const response = await app.fetch(request())
      const reader = response.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
      await app.mockSession.dispose()
      await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
      expect(cancelled).toHaveBeenCalledOnce()
      expect(closed).toHaveBeenCalledOnce()
      expect(finalized).toHaveBeenCalledOnce()
    }
    finally {
      await app.mockSession.dispose()
    }
  })

  it('runs native manifest files and initial overrides through a mounted runtime app', async () => {
    const moduleMap = { './native': { default: [defineHttpHandler(({ params, request }) => HttpResponse.json({ id: params.id, url: request.url }), { once: true }), defineHttpHandler(networkError)] } }
    const manifest = { version: 1 as const, routes: [
      { method: 'GET' as const, url: '/users/[id]', handlerType: 'http' as const, once: true, response: { type: 'module' as const, module: './native', ruleIndex: 0 } },
      { method: 'GET' as const, url: '/users/[id]', handlerType: 'http' as const, response: { type: 'module' as const, module: './native', ruleIndex: 1 } },
    ] }
    const runtime = createRuntime({ manifest, moduleMap })
    const app = await createRuntimeApp({ manifest, moduleMap, handlers: [http.get('/extra', () => HttpResponse.text('extra'))] })
    const parent = new Hono().route('/teams/:tenant', app)
    try {
      expect(await (await runtime.fetch(request()))?.json()).toEqual({ id: '42', url: request().url })
      expect((await runtime.fetch(request()))?.type).toBe('error')
      expect(await (await parent.request('/teams/a/users/42'))?.json()).toEqual({ id: '42', url: 'http://localhost/teams/a/users/42' })
      expect(await (await parent.request('/teams/a/extra')).text()).toBe('extra')
      expect((await parent.request('/teams/a/users/42')).type).toBe('error')
      app.mockSession.restoreHandlers()
      expect((await parent.request('/teams/b/users/42')).status).toBe(200)
    }
    finally {
      await Promise.all([runtime.close(), app.mockSession.dispose()])
    }
  })
})
