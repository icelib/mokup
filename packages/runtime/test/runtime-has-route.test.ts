import type { Manifest, ManifestRoute, MiddlewareHandler, ModuleMap } from '../src/types'
import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '../src/runtime'

function request(path: string, method = 'GET') {
  return { method, path, query: {}, headers: {}, body: undefined }
}

function route(method: 'GET' | 'HEAD', url: string, label: string): ManifestRoute {
  return { method, url, headers: { 'x-route': label }, response: { type: 'text', body: label } }
}

describe('runtime route preflight', () => {
  const manifest: Manifest = { version: 1, routes: [
    route('GET', '/items/[id]', 'get-param'),
    route('GET', '/items/static', 'get-static'),
    route('HEAD', '/items/[id]', 'head-param'),
    route('HEAD', '/items/static', 'head-static'),
    route('GET', '/wide/static', 'get-wide'),
    route('HEAD', '/wide/[...tail]', 'head-wide'),
    route('HEAD', '/optional/[[...tail]]', 'head-optional'),
    route('GET', '/fallback', 'fallback'),
    route('GET', '/(invalid)/route', 'invalid'),
  ] }

  it.each([
    ['HEAD', '/items/static', 'head-static'],
    ['HEAD', '/items/42/', 'head-param'],
    ['GET', '/items/static', 'get-static'],
    ['GET', '/items/42?foo=1#hash', 'get-param'],
    ['HEAD', '/wide/static', 'head-wide'],
    ['GET', '/wide/static', 'get-wide'],
    ['HEAD', '/optional', 'head-optional'],
    ['HEAD', '/optional/a/b', 'head-optional'],
    ['HEAD', '/fallback', 'fallback'],
    ['get', '/fallback', 'fallback'],
    ['UNKNOWN', '/fallback', 'fallback'],
    ['POST', '/items/static', null],
    ['GET', '/optional', null],
    ['HEAD', '/wide', null],
    ['GET', '/missing', null],
    ['GET', '/(invalid)/route', null],
  ] as const)('agrees with handle for %s %s', async (method, path, label) => {
    const runtime = createRuntime({ manifest })
    expect(await runtime.hasRoute({ method, path })).toBe(label !== null)
    const result = await runtime.handle(request(path, method))
    if (label === null) {
      expect(result).toBeNull()
    }
    else {
      expect(result?.headers['x-route']).toBe(label)
      expect(result?.body).toBe(method === 'HEAD' ? null : label)
    }
  })

  it('checks route ownership without reading a body or loading handlers and middleware', async () => {
    const handler = vi.fn(() => 'ok')
    const middleware = vi.fn<MiddlewareHandler>(async (_context, next) => {
      await next()
    })
    const moduleReads: PropertyKey[] = []
    const moduleMap = new Proxy<ModuleMap>({
      './handler.mjs': { default: handler },
      './middleware.mjs': { default: middleware },
    }, {
      get(target, key, receiver) {
        moduleReads.push(key)
        return Reflect.get(target, key, receiver)
      },
    })
    const readBody = vi.fn(() => 'payload')
    const runtimeRequest = {
      ...request('/mock', 'POST'),
      get body() {
        return readBody()
      },
    }
    const runtime = createRuntime({
      manifest: { version: 1, routes: [{
        method: 'POST',
        url: '/mock',
        response: { type: 'module', module: './handler.mjs' },
        middleware: [{ module: './middleware.mjs' }],
      }] },
      moduleMap,
    })

    expect(await runtime.hasRoute(runtimeRequest)).toBe(true)
    expect(await runtime.hasRoute({ method: 'POST', path: '/native' })).toBe(false)
    expect(moduleReads).toEqual([])
    expect(handler).not.toHaveBeenCalled()
    expect(middleware).not.toHaveBeenCalled()
    expect(readBody).not.toHaveBeenCalled()

    expect(await runtime.handle(runtimeRequest)).toMatchObject({ body: 'ok' })
    expect(moduleReads.length).toBeGreaterThan(0)
    expect(handler).toHaveBeenCalledOnce()
    expect(middleware).toHaveBeenCalledOnce()
    expect(readBody).toHaveBeenCalled()
  })

  it('does not require moduleBase until a matched route is handled', async () => {
    const runtime = createRuntime({ manifest: { version: 1, routes: [{
      method: 'POST',
      url: '/module',
      response: { type: 'module', module: './missing.mjs' },
      middleware: [{ module: './missing-middleware.mjs' }],
    }] } })

    expect(await runtime.hasRoute({ method: 'POST', path: '/module' })).toBe(true)
    expect(await runtime.hasRoute({ method: 'POST', path: '/native' })).toBe(false)
    await expect(runtime.handle(request('/module', 'POST'))).rejects.toThrow('moduleBase is required')
  })
})
