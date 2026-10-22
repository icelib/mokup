import type { Context, MiddlewareHandler } from '@mokup/shared/hono'
import type { Manifest, ModuleMap } from '../src/types'
import { describe, expect, it, vi } from 'vitest'
import { createMockSession, getResponseCookies, http, HttpResponse } from '../src/http'
import { captureResponseCookies } from '../src/http/response-cookies'
import { compileManifestHandlers } from '../src/manifest-handlers'
import { createRuntime, createRuntimeApp } from '../src/runtime'

const manifest: Manifest = { version: 1, routes: [{
  method: 'GET',
  url: '/base',
  response: { type: 'text', body: 'manifest' },
}] }

describe('manifest HTTP sessions', () => {
  it('keeps lazy execution consistent with the manifest snapshot used for matching', async () => {
    const source: Manifest = { version: 1, routes: [{
      method: 'GET',
      url: '/original',
      headers: { 'x-generation': 'original' },
      middleware: [{ module: 'original', exportName: 'middleware' }],
      response: { type: 'json', body: { value: 'original' } },
    }] }
    const runtime = createRuntime({
      manifest: source,
      moduleMap: { original: { middleware: async (c: Context, next: () => Promise<void>) => {
        await next()
        c.header('x-middleware', 'original')
      } } },
    })
    try {
      expect(await runtime.hasRoute({ method: 'GET', path: '/original' })).toBe(true)
      await runtime.ready()
      const route = source.routes[0]!
      route.url = '/mutated'
      route.headers!['x-generation'] = 'mutated'
      route.middleware![0]!.module = 'missing'
      if (route.response.type === 'json') {
        (route.response.body as { value: string }).value = 'mutated'
      }
      source.routes.push({ method: 'GET', url: '/late', response: { type: 'text', body: 'late' } })
      const response = await runtime.fetch(new Request('https://example.test/original'))
      expect(await response?.json()).toEqual({ value: 'original' })
      expect(response?.headers.get('x-generation')).toBe('original')
      expect(response?.headers.get('x-middleware')).toBe('original')
      expect(await runtime.hasRoute({ method: 'GET', path: '/late' })).toBe(false)
      expect(await runtime.fetch(new Request('https://example.test/mutated'))).toBeNull()
    }
    finally {
      await runtime.close()
    }
  })
  it.each(['request', 'runtime'] as const)('cancels waiting for a lazy manifest when the %s closes', async (operation) => {
    const pendingManifest = Promise.withResolvers<Manifest>()
    const started = Promise.withResolvers<void>()
    const runtime = createRuntime({ manifest: () => {
      started.resolve()
      return pendingManifest.promise
    } })
    const controller = new AbortController()
    const pending = runtime.fetch(new Request('https://example.test/base', { signal: controller.signal }))
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await started.promise
      if (operation === 'request') {
        controller.abort()
      }
      else {
        await runtime.close()
      }
      await rejected
      expect(runtime.signal.aborted).toBe(operation === 'runtime')
      if (operation === 'request') {
        pendingManifest.resolve(manifest)
        expect(await (await runtime.fetch(new Request('https://example.test/base')))?.text()).toBe('manifest')
      }
    }
    finally {
      pendingManifest.resolve(manifest)
      await runtime.close()
    }
  })

  it.each(['GET', 'HEAD'])('isolates hidden cookies when concurrent %s invocations reuse one Request', async (method) => {
    const gate = Promise.withResolvers<void>()
    let calls = 0
    const app = await createRuntimeApp({
      manifest: { version: 1, routes: [{ method: 'GET', url: '/cookies', response: { type: 'module', module: './cookies.mjs' } }] },
      moduleMap: { './cookies.mjs': { async default() {
        const index = ++calls
        if (calls === 2) {
          gate.resolve()
        }
        await gate.promise
        const response = new Response(`body-${index}`)
        captureResponseCookies(response, { 'set-cookie': `invocation=${index}` })
        return response
      } } },
    })
    const request = new Request('https://example.test/cookies', { method })
    const responses = await Promise.all([app.fetch(request), app.fetch(request)])
    expect(responses.map(getResponseCookies)).toEqual([['invocation=1'], ['invocation=2']])
    expect(await Promise.all(responses.map(response => response.text()))).toEqual(method === 'HEAD' ? ['', ''] : ['body-1', 'body-2'])
  })

  it.each([false, true])('preserves browser-filtered cookies across Hono and route overrides (replace: %s)', async (replace) => {
    const original = ['one=1; Path=/', 'two=2; Path=/']
    const expected = replace ? ['replacement=3; Path=/'] : original
    const runtime = createRuntime({
      manifest: { version: 1, routes: [{
        method: 'GET',
        url: '/cookies',
        status: 202,
        headers: { 'x-route': 'applied', ...(replace ? { 'set-cookie': expected[0]! } : {}) },
        response: { type: 'module', module: './cookies.mjs' },
      }] },
      moduleMap: { './cookies.mjs': { default(c: Context) {
        // Reading c.res forces Hono's response setter to reconstruct the result.
        c.res.headers.set('x-context', 'prepared')
        const response = new Response('body')
        captureResponseCookies(response, original.map(cookie => ['set-cookie', cookie]))
        return response
      } } },
    })
    try {
      for (const method of ['GET', 'HEAD']) {
        const response = await runtime.fetch(new Request('https://example.test/cookies', { method }))
        expect(response?.status).toBe(202)
        expect(response?.headers.get('x-context')).toBe('prepared')
        expect(response?.headers.get('x-route')).toBe('applied')
        expect(getResponseCookies(response!)).toEqual(expected)
        await response?.text()
      }
      const result = await runtime.handle({ method: 'GET', path: '/cookies', query: {}, headers: {}, body: undefined })
      expect(result?.headers['set-cookie']).toBe(expected.at(-1))
      expect(result?.setCookies).toEqual(expected.length > 1 ? expected : undefined)
    }
    finally {
      await runtime.close()
    }
  })

  it('retains Hono params, middleware, cookies, and original URLs in shared sessions', async () => {
    const before: string[] = []
    const middleware: MiddlewareHandler = async (c, next) => {
      before.push(c.req.param('id') ?? '')
      await next()
      c.header('x-middleware', 'applied')
    }
    const handlers = await compileManifestHandlers({
      manifest: { version: 1, routes: [{
        method: 'POST',
        url: '/users/[id]',
        status: 202,
        headers: { 'x-route': 'manifest' },
        middleware: [{ module: './user.mjs', exportName: 'middleware' }],
        response: { type: 'module', module: './user.mjs' },
      }] },
      moduleMap: { './user.mjs': {
        middleware,
        default: async (c: Context) => new Response(JSON.stringify({
          id: c.req.param('id'),
          url: c.req.url,
          body: await c.req.json(),
        }), { headers: [
          ['content-type', 'application/json'],
          ['set-cookie', 'one=1; Path=/'],
          ['set-cookie', 'two=2; Path=/'],
        ] }),
      } },
    })
    const session = createMockSession(...handlers)
    try {
      const response = await session.handle(new Request('https://api.example.test/users/42?q=one&q=two', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: true }),
      }))
      expect(response?.status).toBe(202)
      expect(response?.headers.get('x-middleware')).toBe('applied')
      expect(response?.headers.get('x-route')).toBe('manifest')
      expect(response?.headers.getSetCookie()).toEqual(['one=1; Path=/', 'two=2; Path=/'])
      expect(await response?.json()).toEqual({
        id: '42',
        url: 'https://api.example.test/users/42?q=one&q=two',
        body: { hello: true },
      })
      expect(before).toEqual(['42'])
    }
    finally {
      await session.dispose()
    }
  })

  it.each([':fixed', '*', 'ab{2}', 'a|b', '中文'])('keeps literal file segment %s when compiling HTTP handlers', async (literal) => {
    const handlers = await compileManifestHandlers({ manifest: { version: 1, routes: [
      { method: 'GET', url: `/users/${literal}`, headers: { 'x-route': 'literal' }, response: { type: 'text', body: 'literal' } },
      { method: 'GET', url: '/users/[id]', headers: { 'x-route': 'dynamic' }, response: { type: 'text', body: 'dynamic' } },
    ] } })
    const session = createMockSession(...handlers)
    try {
      for (const [path, expected] of [[`/users/${literal}`, 'literal'], ['/users/other', 'dynamic']] as const) {
        const response = await session.handle(new Request(`https://example.test${path}`))
        expect(response?.headers.get('x-route')).toBe(expected)
        expect(await response?.text()).toBe(expected)
      }
    }
    finally {
      await session.dispose()
    }
  })

  it('selects explicit HEAD handlers before GET fallbacks', async () => {
    const runtime = createRuntime({ manifest: { version: 1, routes: [
      { method: 'GET', url: '/items/static', status: 201, response: { type: 'text', body: 'get' } },
      { method: 'HEAD', url: '/items/[id]', status: 202, response: { type: 'text', body: 'head' } },
      { method: 'GET', url: '/fallback', status: 203, response: { type: 'text', body: 'fallback' } },
    ] } })
    try {
      const head = await runtime.fetch(new Request('https://example.test/items/static', { method: 'HEAD' }))
      expect(head?.status).toBe(202)
      expect(head?.body).toBeNull()
      const fallback = await runtime.fetch(new Request('https://example.test/fallback', { method: 'HEAD' }))
      expect(fallback?.status).toBe(203)
      expect(fallback?.body).toBeNull()
    }
    finally {
      await runtime.close()
    }
  })

  it('queues controls and events without loading the manifest or modules', async () => {
    const loader = vi.fn(async () => manifest)
    const runtime = createRuntime({ manifest: loader })
    const events: string[] = []
    runtime.events.on('request:start', event => events.push(event.url))
    runtime.use(http.get('/base', () => HttpResponse.text('override')))
    runtime.setOnUnhandled('error')
    expect(loader).not.toHaveBeenCalled()
    try {
      expect(await runtime.ready()).toBe(await runtime.ready())
      expect(loader).toHaveBeenCalledOnce()
      expect(await (await runtime.fetch(new Request('https://example.test/base')))?.text()).toBe('override')
      runtime.resetHandlers()
      expect(await (await runtime.fetch(new Request('https://example.test/base')))?.text()).toBe('manifest')
      expect(await runtime.listHandlers()).toHaveLength(1)
      expect(events).toEqual(['https://example.test/base', 'https://example.test/base'])
      await expect(runtime.fetch(new Request('https://example.test/missing'))).rejects.toThrow('Unhandled request')
    }
    finally {
      await runtime.close()
    }
    await expect(runtime.ready()).rejects.toThrow('closed')
    expect(() => runtime.resetHandlers()).toThrow('closed')
  })

  it('does not read unmatched bodies or load module exports during preflight and ready', async () => {
    const moduleReads: PropertyKey[] = []
    const moduleMap = new Proxy<ModuleMap>({ './handler.mjs': { default: () => 'loaded' } }, {
      get(target, property, receiver) {
        moduleReads.push(property)
        return Reflect.get(target, property, receiver)
      },
    })
    const runtime = createRuntime({
      manifest: { version: 1, routes: [{ method: 'POST', url: '/module', response: { type: 'module', module: './handler.mjs' } }] },
      moduleMap,
    })
    try {
      expect(await runtime.hasRoute({ method: 'POST', path: '/module' })).toBe(true)
      await runtime.ready()
      const unmatched = new Request('https://example.test/native', { method: 'POST', body: 'untouched' })
      expect(await runtime.fetch(unmatched)).toBeNull()
      expect(unmatched.bodyUsed).toBe(false)
      expect(await unmatched.text()).toBe('untouched')
      expect(moduleReads).toEqual([])
      expect(await (await runtime.fetch(new Request('https://example.test/module', { method: 'POST' })))?.text()).toBe('loaded')
      expect(moduleReads.length).toBeGreaterThan(0)
    }
    finally {
      await runtime.close()
    }
  })

  it('checks relative module requirements only when their route matches', async () => {
    const runtime = createRuntime({ manifest: { version: 1, routes: [
      ...manifest.routes,
      { method: 'GET', url: '/module', response: { type: 'module', module: './missing.mjs' } },
    ] } })
    try {
      await runtime.ready()
      expect(await (await runtime.fetch(new Request('https://example.test/base')))?.text()).toBe('manifest')
      await expect(runtime.fetch(new Request('https://example.test/module'))).rejects.toThrow('moduleBase is required')
    }
    finally {
      await runtime.close()
    }
  })

  it('does not tee upload bodies while scanning manifest paths', async () => {
    const clone = vi.spyOn(Request.prototype, 'clone')
    const runtime = createRuntime({ manifest: { version: 1, routes: Array.from({ length: 100 }, (_, index) => ({
      method: 'POST',
      url: `/uploads/${index}`,
      response: { type: 'text', body: 'ok' },
    })) } })
    try {
      const missing = new Request('https://example.test/native', { method: 'POST', body: 'original' })
      expect(await runtime.fetch(missing)).toBeNull()
      expect(clone).not.toHaveBeenCalled()
      expect(missing.bodyUsed).toBe(false)
      const matched = new Request('https://example.test/uploads/99', { method: 'POST', body: 'original' })
      expect(await (await runtime.fetch(matched))?.text()).toBe('ok')
      expect(clone).toHaveBeenCalledOnce()
      expect(matched.bodyUsed).toBe(false)
      expect(await matched.text()).toBe('original')
    }
    finally {
      clone.mockRestore()
      await runtime.close()
    }
  })

  it.each(['abort', 'close', 'cancel'] as const)('streams immediately and releases a Hono stream on %s', async (operation) => {
    const cancel = vi.fn()
    let streamSignal: AbortSignal | undefined
    const runtime = createRuntime({
      manifest: { version: 1, routes: [{ method: 'GET', url: '/stream', response: { type: 'module', module: './stream.mjs' } }] },
      moduleMap: { './stream.mjs': { default: (c: Context) => {
        streamSignal = c.req.raw.signal
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('first'))
          },
          cancel,
        }))
      } } },
    })
    const controller = new AbortController()
    try {
      const response = await runtime.fetch(new Request('https://example.test/stream?original=yes', { signal: controller.signal }))
      const reader = response?.body?.getReader()
      expect(reader).toBeDefined()
      expect(new TextDecoder().decode((await reader!.read()).value)).toBe('first')
      if (operation === 'cancel') {
        await reader!.cancel('consumer stopped')
      }
      else {
        if (operation === 'abort') {
          controller.abort()
        }
        else {
          await runtime.close()
        }
        await expect(reader!.read()).rejects.toMatchObject({ name: 'AbortError' })
        expect(streamSignal?.aborted).toBe(true)
      }
      expect(cancel).toHaveBeenCalledOnce()
    }
    finally {
      await runtime.close()
    }
  })
})
