import type { Context } from '@mokup/shared/hono'
import type { ControlledFetchHandler, ServerOptions } from '../src/types'
import { http, HttpResponse, passthrough } from '@mokup/runtime/http'
import { Hono } from '@mokup/shared/hono'
import { describe, expect, it, vi } from 'vitest'
import { createFetchHandler } from '../src/fetch'
import { createHonoMiddleware } from '../src/hono'
import { createMokupWorker } from '../src/worker'
import { createMokupWorker as createNodeWorker } from '../src/worker-node'

const manifest: ServerOptions['manifest'] = { version: 1, routes: [
  { method: 'GET', url: '/base', response: { type: 'text', body: 'file' } },
] }

const adapters = [
  ['Fetch', (options: ServerOptions) => createFetchHandler(options)],
  ['Worker', (options: ServerOptions) => {
    const worker = createMokupWorker({ ...options, manifest })
    return Object.assign((request: Request) => worker.fetch(request), worker)
  }],
  ['Node Worker', (options: ServerOptions) => {
    const worker = createNodeWorker({ ...options, manifest })
    return Object.assign((request: Request) => worker.fetch(request), worker)
  }],
] satisfies [string, (options: ServerOptions) => ControlledFetchHandler][]

describe.each(adapters)('%s deployed HTTP session', (_name, createAdapter) => {
  it('shares native definitions, queued overrides, once consumption and reset with file routes', async () => {
    const adapter = createAdapter({ manifest, handlers: [http.get('/native', () => HttpResponse.text('initial'))] })
    adapter.use(http.get('/base', () => HttpResponse.text('once'), { once: true }))
    try {
      expect(await adapter.ready()).toBe(await adapter.ready())
      const send = async (path: string) => (await adapter(new Request(`https://example.test${path}`)))?.text()
      expect(await send('/base')).toBe('once')
      expect(await send('/base')).toBe('file')
      adapter.restoreHandlers()
      expect(await send('/base')).toBe('once')
      expect(await send('/native')).toBe('initial')
      adapter.resetHandlers()
      expect(await adapter.listHandlers()).toHaveLength(2)
      expect(await send('/base')).toBe('file')
    }
    finally {
      await adapter.close()
    }
    await expect(adapter(new Request('https://example.test/base'))).rejects.toThrow('closed')
    expect(() => adapter.use(http.get('*', () => undefined))).toThrow('closed')
  })

  it('applies miss policies and events to paths outside the manifest', async () => {
    const policy = vi.fn()
    const adapter = createAdapter({ manifest, onUnhandled: policy })
    const events: { type: string, id: string }[] = []
    for (const type of ['request:start', 'request:unhandled', 'response:bypass', 'request:end'] as const) {
      adapter.events.on(type, event => events.push({ type, id: event.requestId }))
    }
    try {
      await adapter(new Request('https://example.test/native'))
      expect(policy).toHaveBeenCalledOnce()
      expect(events.map(event => event.type)).toEqual(['request:start', 'request:unhandled', 'response:bypass', 'request:end'])
      expect(new Set(events.map(event => event.id)).size).toBe(1)
      adapter.setOnUnhandled('error')
      await expect(adapter(new Request('https://example.test/error'))).rejects.toThrow('Unhandled request')
    }
    finally {
      await adapter.close()
    }
  })

  it('closing the adapter cancels live native response streams', async () => {
    const cancel = vi.fn()
    const adapter = createAdapter({ manifest, handlers: [http.get('/stream', () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('first')) },
      cancel,
    })))] })
    try {
      const response = await adapter(new Request('https://example.test/stream'))
      const reader = response!.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
      await adapter.close()
      await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
      expect(cancel).toHaveBeenCalledOnce()
    }
    finally {
      await adapter.close()
    }
  })
})

describe('deployed transport context and body ownership', () => {
  it('dispatches a mounted Hono middleware through the shared relative scope', async () => {
    const middleware = createHonoMiddleware({
      manifest: { version: 1, routes: [{ method: 'GET', url: '/users/[id]', response: { type: 'module', module: 'users' } }] },
      moduleMap: { users: { default: (c: Context) => {
        c.set('visited', true)
        return c.json({ params: c.req.param(), url: c.req.url, label: c.get('label') })
      } } },
    })
    const child = new Hono().basePath('/api')
    child.use('*', middleware)
    const app = new Hono()
    const after = vi.fn()
    app.use('*', async (c, next) => {
      c.set('label', 'parent')
      await next()
      after(c.get('visited'))
    })
    app.route('/teams/:tenant', child)
    middleware.use(http.get('/native', ({ request }) => HttpResponse.text(request.url), { once: true }))
    try {
      const response = await app.request('/teams/team/api/users/42?q=original')
      expect(await response.json()).toEqual({ params: { tenant: 'team', id: '42' }, url: 'http://localhost/teams/team/api/users/42?q=original', label: 'parent' })
      expect(after).toHaveBeenCalledWith(true)
      expect(await (await app.request('/teams/team/api/native')).text()).toBe('http://localhost/teams/team/api/native')
      expect((await app.request('/teams/team/api/native')).status).toBe(404)
      middleware.restoreHandlers()
      expect((await app.request('/teams/other/api/native')).status).toBe(200)
    }
    finally {
      await middleware.close()
    }
  })
  it('preserves Fetch bodies after body-reading predicates and explicit passthrough', async () => {
    const adapter = createFetchHandler({
      manifest,
      handlers: [http.post(async ({ request }) => (await request.text()) === 'original', async ({ request }) => {
        expect(await request.text()).toBe('original')
        return passthrough()
      })],
      onUnhandled: 'error',
    })
    try {
      const request = new Request('https://example.test/native', { method: 'POST', body: 'original' })
      expect(await adapter(request)).toBeNull()
      expect(request.bodyUsed).toBe(false)
      expect(await request.text()).toBe('original')
    }
    finally {
      await adapter.close()
    }
  })

  it.each([createMokupWorker, createNodeWorker])('forwards concurrent Worker bindings and execution contexts to file handlers', async (createWorker) => {
    const contexts = [{ waitUntil: vi.fn() }, { waitUntil: vi.fn() }]
    const gate = Promise.withResolvers<void>()
    let entered = 0
    const worker = createWorker({
      manifest: { version: 1, routes: [{ method: 'GET', url: '/bindings', response: { type: 'module', module: 'bindings' } }] },
      moduleMap: { bindings: { default: async (c: Context) => {
        if (++entered === 2) {
          gate.resolve()
        }
        await gate.promise
        c.executionCtx.waitUntil(Promise.resolve())
        return c.json(c.env)
      } } },
    })
    try {
      const responses = await Promise.all(contexts.map((context, index) => worker.fetch(new Request('https://example.test/bindings'), { label: `request-${index}` }, context)))
      expect(await Promise.all(responses.map(response => response.json()))).toEqual([{ label: 'request-0' }, { label: 'request-1' }])
      contexts.forEach(context => expect(context.waitUntil).toHaveBeenCalledOnce())
    }
    finally {
      await worker.close()
    }
  })

  it('forwards Hono bindings to file handlers while preserving native passthrough bodies', async () => {
    const middleware = createHonoMiddleware({
      manifest: { version: 1, routes: [{ method: 'GET', url: '/bindings', response: { type: 'module', module: 'bindings' } }] },
      moduleMap: { bindings: { default: (c: Context) => c.json(c.env) } },
      handlers: [http.post('/native', async ({ request }) => {
        expect(await request.text()).toBe('original')
        return passthrough()
      })],
    })
    const app = new Hono()
    app.use('*', middleware)
    app.post('/native', async c => c.text(await c.req.text()))
    try {
      expect(await (await app.fetch(new Request('https://example.test/bindings'), { label: 'Hono' })).json()).toEqual({ label: 'Hono' })
      expect(await (await app.fetch(new Request('https://example.test/native', { method: 'POST', body: 'original' }))).text()).toBe('original')
      middleware.use(http.get('/new', () => HttpResponse.text('override')))
      expect(await (await app.fetch(new Request('https://example.test/new'))).text()).toBe('override')
    }
    finally {
      await middleware.close()
    }
  })
})
