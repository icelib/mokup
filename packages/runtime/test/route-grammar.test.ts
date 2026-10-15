import type { Context, MiddlewareHandler } from '@mokup/shared/hono'
import type { Manifest, ManifestRoute, ModuleMap } from '../src/types'
import { Hono } from '@mokup/shared/hono'
import { describe, expect, it } from 'vitest'
import { createRuntime, createRuntimeApp } from '../src/runtime'

function request(path: string, method = 'GET') {
  return { method, path, query: {}, headers: {}, body: undefined }
}

const parameterCases: Array<{ url: string, path: string, params: Record<string, string> }> = [
  { url: '/users/[user-id]', path: '/users/one', params: { 'user-id': 'one' } },
  { url: '/users/[123]', path: '/users/one', params: { 123: 'one' } },
  { url: '/[id]/[id]', path: '/first/second', params: { id: 'second' } },
  { url: '/docs/[id]/[...id]', path: '/docs/first/second/third', params: { id: 'second/third' } },
  { url: '/docs/[id]/[[...id]]', path: '/docs/first', params: {} },
]

describe('runtime route grammar', () => {
  it.each(parameterCases)('serves accepted parameter names in $url without breaking other routes', async ({ url, path, params }) => {
    const manifest: Manifest = { version: 1, routes: [
      { method: 'GET', url, response: { type: 'module', module: './params.mjs' } },
      { method: 'GET', url: '/health', response: { type: 'text', body: 'healthy' } },
    ] }
    const moduleMap: ModuleMap = { './params.mjs': { default: (c: Context) => ({
      params: c.req.param(),
      numeric: c.req.param('123') ?? null,
      dashed: c.req.param('user-id') ?? null,
      id: c.req.param('id') ?? null,
    }) } }
    const runtime = createRuntime({ manifest, moduleMap })

    expect(await runtime.hasRoute(request(path))).toBe(true)
    expect(await runtime.handle(request('/health'))).toMatchObject({ status: 200, body: 'healthy' })
    const result = await runtime.handle(request(path))
    expect(result?.status).toBe(200)
    const expected = {
      params,
      numeric: params['123'] ?? null,
      dashed: params['user-id'] ?? null,
      id: params['id'] ?? null,
    }
    expect(JSON.parse(String(result?.body))).toEqual(expected)

    const app = await createRuntimeApp({ manifest, moduleMap })
    const response = await app.request(path)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expected)
  })

  it.each([':fixed', '*', 'ab{2}', 'a|b'])('matches the static segment %s literally without intercepting dynamic routes', async (literal) => {
    const manifest: Manifest = { version: 1, routes: [
      {
        method: 'GET',
        url: `/users/${literal}`,
        headers: { 'x-route': 'literal' },
        response: { type: 'text', body: 'literal' },
      },
      {
        method: 'GET',
        url: '/users/[id]',
        headers: { 'x-route': 'dynamic' },
        response: { type: 'text', body: 'dynamic' },
      },
    ] }
    const runtime = createRuntime({ manifest })
    const app = await createRuntimeApp({ manifest })

    for (const [path, expected] of [
      [`/users/${literal}`, 'literal'],
      ['/users/other', 'dynamic'],
      ['/users/abb', 'dynamic'],
    ] as const) {
      expect(await runtime.hasRoute(request(path))).toBe(true)
      expect(await runtime.handle(request(path))).toMatchObject({
        status: 200,
        body: expected,
        headers: { 'x-route': expected },
      })
      const response = await app.request(path)
      expect(response.headers.get('x-route')).toBe(expected)
      await expect(response.text()).resolves.toBe(expected)
    }

    expect(await runtime.hasRoute(request('/outside/b'))).toBe(false)
    expect(await runtime.handle(request('/outside/b'))).toBeNull()
    expect((await app.request('/outside/b')).status).toBe(404)
  })

  it.each(['GET', 'HEAD'] as const)('preserves %s params and middleware when mounted on a parent Hono app', async (method) => {
    const expected = { 'tenant': 'team', 'user-id': 'user', '123': 'number', 'id': 'last', 'rest': 'a b/c' }
    const observed: Array<{ method: string, phase: string, params: Record<string, string> }> = []
    const moduleMap: ModuleMap = {}
    const routes: ManifestRoute[] = []
    for (const routeMethod of ['GET', 'HEAD'] as const) {
      const middleware: MiddlewareHandler = async (c, next) => {
        observed.push({ method: routeMethod, phase: 'before', params: c.req.param() })
        await next()
        observed.push({ method: routeMethod, phase: 'after', params: c.req.param() })
      }
      moduleMap[`./${routeMethod}.mjs`] = { default: (c: Context) => new Response(routeMethod, {
        headers: {
          'x-method': c.req.method,
          'x-route': routeMethod,
          'x-params': JSON.stringify(c.req.param()),
          'x-tenant': c.req.param('tenant') ?? '',
          'x-user': c.req.param('user-id') ?? '',
          'x-number': c.req.param('123') ?? '',
          'x-id': c.req.param('id') ?? '',
          'x-rest': c.req.param('rest') ?? '',
        },
      }), middleware }
      routes.push({
        method: routeMethod,
        url: '/records/*/[user-id]/[123]/[id]/[id]/[...rest]',
        response: { type: 'module', module: `./${routeMethod}.mjs` },
        middleware: [{ module: `./${routeMethod}.mjs`, exportName: 'middleware' }],
      })
    }
    const child = await createRuntimeApp({ manifest: { version: 1, routes }, moduleMap })
    child.onError((_error, c) => c.text('unexpected error', 500))
    const parent = new Hono()
    let before: Record<string, string> | undefined
    let after: Record<string, string> | undefined
    parent.use('/prefix/:tenant/*', async (c, next) => {
      before = c.req.param()
      await next()
      after = c.req.param()
    })
    parent.route('/prefix/:tenant', child)

    const response = await parent.request('/prefix/team/records/*/user/number/first/last/a%20b/c', { method })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-method')).toBe(method)
    expect(response.headers.get('x-route')).toBe(method)
    expect(JSON.parse(response.headers.get('x-params') ?? 'null')).toEqual(expected)
    expect(response.headers.get('x-tenant')).toBe('team')
    expect(response.headers.get('x-user')).toBe('user')
    expect(response.headers.get('x-number')).toBe('number')
    expect(response.headers.get('x-id')).toBe('last')
    expect(response.headers.get('x-rest')).toBe('a b/c')
    await expect(response.text()).resolves.toBe(method === 'HEAD' ? '' : 'GET')
    expect(before).toEqual({ tenant: 'team' })
    expect(after).toEqual(expected)
    expect(observed).toEqual([
      { method, phase: 'before', params: expected },
      { method, phase: 'after', params: expected },
    ])
  })

  it('preserves public params in a mounted custom error handler and the surrounding middleware', async () => {
    const child = await createRuntimeApp({
      manifest: { version: 1, routes: [{
        method: 'GET',
        url: '/users/[user-id]/[id]/[id]',
        response: { type: 'module', module: './failure.mjs' },
      }] },
      moduleMap: { './failure.mjs': { default: () => { throw new Error('handler failed') } } },
    })
    child.onError((error, c) => c.json({
      message: error.message,
      params: c.req.param(),
      user: c.req.param('user-id'),
      id: c.req.param('id'),
    }, 500))
    const parent = new Hono()
    let paramsAfterError: Record<string, string> | undefined
    parent.use('*', async (c, next) => {
      await next()
      paramsAfterError = c.req.param()
    })
    parent.route('/prefix/:tenant', child)

    const response = await parent.request('/prefix/team/users/user/first/last')
    const expected = { 'tenant': 'team', 'user-id': 'user', 'id': 'last' }
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ message: 'handler failed', params: expected, user: 'user', id: 'last' })
    expect(paramsAfterError).toEqual(expected)
  })

  it('keeps public params after GET skips every handler of a mounted HEAD-only route', async () => {
    const child = await createRuntimeApp({ manifest: { version: 1, routes: [{
      method: 'HEAD',
      url: '/only/[user-id]',
      response: { type: 'text', body: 'HEAD only' },
    }] } })
    child.onError((_error, c) => c.text('unexpected error', 500))
    const parent = new Hono()
    let paramsAfterNotFound: Record<string, string> | undefined
    parent.use('/prefix/:tenant/*', async (c, next) => {
      await next()
      paramsAfterNotFound = c.req.param()
    })
    parent.route('/prefix/:tenant', child)

    const response = await parent.request('/prefix/team/only/user')
    expect(response.status).toBe(404)
    expect(paramsAfterNotFound).toEqual({ 'tenant': 'team', 'user-id': 'user' })
  })

  it('uses the parent route params when a mounted HEAD guard calls next for GET', async () => {
    const child = await createRuntimeApp({ manifest: { version: 1, routes: [{
      method: 'HEAD',
      url: '/only/[user-id]',
      response: { type: 'text', body: 'HEAD only' },
    }] } })
    const parent = new Hono()
    let paramsAfterFallback: Record<string, string> | undefined
    parent.use('/prefix/:tenant/*', async (c, next) => {
      await next()
      paramsAfterFallback = c.req.param()
    })
    parent.route('/prefix/:tenant', child)
    parent.get('/prefix/:tenant/only/:fallback', c => c.json({
      params: c.req.param(),
      value: c.req.param('fallback'),
      childParam: c.req.param('user-id') ?? null,
    }))

    const response = await parent.request('/prefix/team/only/user')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      params: { tenant: 'team', fallback: 'user' },
      value: 'user',
      childParam: null,
    })
    expect(paramsAfterFallback).toEqual({ tenant: 'team', fallback: 'user' })
  })
})
