import type { Context, MiddlewareHandler } from '@mokup/shared/hono'
import type { Manifest, ManifestRoute, ModuleMap } from '../src/types'
import { handle, Hono } from '@mokup/shared/hono'
import { describe, expect, it, vi } from 'vitest'
import { createRuntime, createRuntimeApp } from '../src/runtime'

function request(path: string, method = 'HEAD') {
  return { method, path, query: {}, headers: {}, body: undefined }
}

function route(method: 'GET' | 'HEAD', url: string, label: string): ManifestRoute {
  return { method, url, headers: { 'x-route': label }, response: { type: 'text', body: label } }
}

describe('runtime explicit HEAD routes', () => {
  it.each(['handle', 'fetch'] as const)('selects HEAD before GET while retaining path priorities through %s', async (entryPoint) => {
    const manifest: Manifest = { version: 1, routes: [
      route('GET', '/items/static', 'get-static'),
      route('GET', '/items/[id]', 'get-param'),
      route('HEAD', '/items/[id]', 'head-param'),
      route('HEAD', '/items/static', 'head-static'),
      route('GET', '/wide/static', 'get-wide'),
      route('HEAD', '/wide/[...tail]', 'head-wide'),
      route('HEAD', '/optional/[[...tail]]', 'head-optional'),
      route('GET', '/fallback', 'fallback'),
    ] }
    const runtime = createRuntime({ manifest })
    const app = await createRuntimeApp({ manifest })
    for (const [method, path, label] of [
      ['HEAD', '/items/static', 'head-static'],
      ['HEAD', '/items/42/', 'head-param'],
      ['GET', '/items/static', 'get-static'],
      ['GET', '/items/42', 'get-param'],
      ['HEAD', '/wide/static', 'head-wide'],
      ['GET', '/wide/static', 'get-wide'],
      ['HEAD', '/optional', 'head-optional'],
      ['HEAD', '/optional/a/b', 'head-optional'],
      ['HEAD', '/fallback', 'fallback'],
    ]) {
      if (entryPoint === 'handle') {
        const result = await runtime.handle(request(path!, method!))
        expect(result?.headers['x-route'], `${method} ${path}`).toBe(label)
        expect(result?.body).toBe(method === 'HEAD' ? null : label)
      }
      else {
        const response = await app.fetch(new Request(`http://localhost${path}`, { method: method! }))
        expect(response.headers.get('x-route'), `${method} ${path}`).toBe(label)
        expect(await response.text()).toBe(method === 'HEAD' ? '' : label)
      }
    }
    expect(await runtime.handle(request('/optional', 'GET'))).toBeNull()
    expect(await runtime.handle(request('/wide'))).toBeNull()
  })

  it('uses the selected method for module requirements and response overrides', async () => {
    const runtime = createRuntime({ manifest: { version: 1, routes: [
      { method: 'GET', url: '/head-static', status: 201, response: { type: 'module', module: './missing-get.mjs' } },
      { ...route('HEAD', '/head-static', 'head'), status: 202 },
      route('GET', '/head-module', 'get'),
      { method: 'HEAD', url: '/head-module', response: { type: 'module', module: './missing-head.mjs' } },
    ] } })
    expect(await runtime.handle(request('/head-static'))).toMatchObject({ status: 202, headers: { 'x-route': 'head' }, body: null })
    await expect(runtime.handle(request('/head-static', 'GET'))).rejects.toThrow('moduleBase is required')
    await expect(runtime.handle(request('/head-module'))).rejects.toThrow('moduleBase is required')
    expect(await runtime.handle(request('/head-module', 'GET'))).toMatchObject({ status: 200, body: 'get' })
  })

  it('preserves selected middleware, original methods and params for concurrent mounted requests', async () => {
    const seen: string[] = []
    const moduleMap: ModuleMap = {}
    const routes: ManifestRoute[] = []
    for (const method of ['GET', 'HEAD'] as const) {
      const middleware: MiddlewareHandler = async (c, next) => {
        seen.push(`${method}:before:${c.req.method}`)
        await next()
        seen.push(`${method}:after:${c.req.method}`)
        c.header('x-middleware', method)
      }
      moduleMap[`./${method}.mjs`] = { default: (c: Context) => new Response(method, {
        headers: { 'x-method': c.req.method, 'x-id': c.req.param('id') ?? '', 'x-tenant': c.req.param('tenant') ?? '', 'x-route': 'handler' },
      }), middleware }
      routes.push({
        method,
        url: '/items/[id]',
        status: method === 'HEAD' ? 202 : 201,
        headers: { 'x-route': method },
        response: { type: 'module', module: `./${method}.mjs` },
        middleware: [{ module: `./${method}.mjs`, exportName: 'middleware' }],
      })
    }
    const child = await createRuntimeApp({ manifest: { version: 1, routes }, moduleMap })
    child.onError((_error, c) => c.text('error', 500))
    const parent = new Hono().route('/mounted/:tenant', child)
    const [head, get] = await Promise.all(['HEAD', 'GET'].map(method => parent.request('/mounted/team/items/42', { method })))
    expect(head?.status).toBe(202)
    expect(get?.status).toBe(201)
    for (const [response, method] of [[head, 'HEAD'], [get, 'GET']] as const) {
      expect(response?.headers.get('x-method')).toBe(method)
      expect(response?.headers.get('x-route')).toBe(method)
      expect(response?.headers.get('x-middleware')).toBe(method)
      expect(response?.headers.get('x-id')).toBe('42')
      expect(response?.headers.get('x-tenant')).toBe('team')
      expect(await response?.text()).toBe(method === 'HEAD' ? '' : 'GET')
    }
    expect(seen.filter(event => event.startsWith('HEAD'))).toEqual(['HEAD:before:HEAD', 'HEAD:after:HEAD'])
    expect(seen.filter(event => event.startsWith('GET'))).toEqual(['GET:before:GET', 'GET:after:GET'])
  })

  it('serves explicit HEAD responses through the Service Worker adapter', async () => {
    const app = await createRuntimeApp({ manifest: { version: 1, routes: [route('HEAD', '/only', 'head')] } })
    const network = vi.fn(async () => new Response('network'))
    const listener = handle(app, { fetch: network })
    let response: Promise<Response> | undefined
    listener({
      request: new Request('http://localhost/only', { method: 'HEAD' }),
      respondWith: (value: Promise<Response>) => {
        response = value
      },
    } as unknown as Parameters<typeof listener>[0])
    expect((await response)?.headers.get('x-route')).toBe('head')
    expect(await (await response)?.text()).toBe('')
    expect(network).not.toHaveBeenCalled()
  })

  it.each(['HEAD', 'GET'] as const)('cancels streamed %s responses through runtime.handle and mounted apps', async (method) => {
    const cancel = vi.fn()
    const options = {
      manifest: { version: 1, routes: [{ method, url: '/stream', response: { type: 'module', module: './stream.mjs' } }] } as Manifest,
      moduleMap: { './stream.mjs': { default: () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('payload'))
        },
        cancel,
      }), { headers: { 'content-length': '7' } }) } },
    }
    const result = await createRuntime(options).handle(request('/stream'))
    expect(result).toMatchObject({ status: 200, body: null, headers: { 'content-length': '7' } })
    expect(cancel).toHaveBeenCalledTimes(1)
    const child = await createRuntimeApp(options)
    child.onError((_error, c) => c.text('error', 500))
    const app = new Hono().route('/mounted', child)
    const response = await app.request('/mounted/stream', { method: 'HEAD' })
    expect(response.headers.get('content-length')).toBe('7')
    expect(response.body).toBeNull()
    expect(cancel).toHaveBeenCalledTimes(2)
  })
})
