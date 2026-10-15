import type { Context } from '@mokup/shared/hono'
import type { ResolvedRoute } from '../src/dev/types'
import { parseRouteTemplate } from '@mokup/runtime'
import { Hono } from '@mokup/shared/hono'
import { describe, expect, it, vi } from 'vitest'
import { createHonoApp } from '../src/dev/hono'
import { buildFetchServerApp } from '../src/fetch-server/app'

function route(method: 'GET' | 'HEAD', path: string, handler: ResolvedRoute['handler'], extra: Partial<ResolvedRoute> = {}): ResolvedRoute {
  const parsed = parseRouteTemplate(path)
  return { method, file: `${path}.${method}.ts`, template: parsed.template, tokens: parsed.tokens, score: parsed.score, handler, ...extra }
}

describe('server explicit HEAD routes', () => {
  it('runs only the selected complete middleware chain and response hook under a parent Hono', async () => {
    const events: string[] = []
    const makeRoute = (method: 'GET' | 'HEAD') => route(method, '/items/[id]', (c: Context) => {
      events.push(`${method}:handler:${c.req.method}:${c.req.param('id')}:${c.req.param('tenant')}`)
      c.header('x-route', 'handler')
      return method
    }, {
      status: method === 'HEAD' ? 202 : 201,
      headers: { 'x-route': method },
      middlewares: (['pre', 'normal', 'post'] as const).map((position, index) => ({
        source: `${method}.ts`,
        index,
        position,
        handle: async (c, next) => {
          events.push(`${method}:${position}:before`)
          await next()
          events.push(`${method}:${position}:after`)
          c.header(`x-${position}`, method)
        },
      })),
    })
    const onResponse = vi.fn((selected: ResolvedRoute, response: Response) => {
      events.push(`${selected.method}:response:${response.status}`)
    })
    const child = createHonoApp([makeRoute('GET'), makeRoute('HEAD')], { onResponse })
    child.onError((_error, c) => c.text('error', 500))
    const parent = new Hono()
    parent.use('*', async (_c, next) => {
      events.push('parent:before')
      await next()
      events.push('parent:after')
    })
    parent.route('/mounted/:tenant', child)
    expect(child).toBeInstanceOf(Hono)
    for (const method of ['HEAD', 'GET']) {
      events.length = 0
      onResponse.mockClear()
      const response = await parent.request('/mounted/team/items/42', { method })
      expect(response.status).toBe(method === 'HEAD' ? 202 : 201)
      expect(response.headers.get('x-route')).toBe(method)
      for (const position of ['pre', 'normal', 'post']) {
        expect(response.headers.get(`x-${position}`)).toBe(method)
      }
      expect(await response.text()).toBe(method === 'HEAD' ? '' : 'GET')
      expect(events).toEqual([
        'parent:before',
        `${method}:pre:before`,
        `${method}:normal:before`,
        `${method}:post:before`,
        `${method}:handler:${method}:42:team`,
        `${method}:post:after`,
        `${method}:normal:after`,
        `${method}:pre:after`,
        `${method}:response:${method === 'HEAD' ? 202 : 201}`,
        'parent:after',
      ])
      expect(onResponse).toHaveBeenCalledTimes(1)
    }
  })

  it('preserves HEAD path specificity and falls back to GET only without matching HEAD', async () => {
    const withLabel = (method: 'GET' | 'HEAD', path: string, label: string) => route(method, path, (c: Context) => new Response(label, { headers: { 'x-route': label, 'x-method': c.req.method, 'x-id': c.req.param('id') ?? '' } }))
    const app = createHonoApp([
      withLabel('GET', '/items/static', 'get-static'),
      withLabel('GET', '/items/[id]', 'get-param'),
      withLabel('HEAD', '/items/static', 'head-static'),
      withLabel('HEAD', '/items/[id]', 'head-param'),
      withLabel('GET', '/wide/static', 'get-wide'),
      withLabel('HEAD', '/wide/[...tail]', 'head-wide'),
      withLabel('HEAD', '/optional/[[...tail]]', 'head-optional'),
      withLabel('GET', '/fallback/[id]', 'fallback'),
    ])
    for (const [method, path, expected] of [
      ['HEAD', '/items/static', 'head-static'],
      ['HEAD', '/items/42/', 'head-param'],
      ['GET', '/items/static', 'get-static'],
      ['GET', '/items/42', 'get-param'],
      ['HEAD', '/wide/static', 'head-wide'],
      ['GET', '/wide/static', 'get-wide'],
      ['HEAD', '/optional', 'head-optional'],
      ['HEAD', '/optional/a/b', 'head-optional'],
      ['HEAD', '/fallback/42', 'fallback'],
    ]) {
      const response = await app.request(path!, { method: method! })
      expect(response.headers.get('x-route'), `${method} ${path}`).toBe(expected)
      expect(response.headers.get('x-method')).toBe(method)
      expect(await response.text()).toBe(method === 'HEAD' ? '' : expected)
    }
    expect((await app.request('/wide', { method: 'HEAD' })).status).toBe(404)
    expect((await app.request('/optional', { method: 'GET' })).status).toBe(404)
  })

  it('preserves early middleware responses without executing another method or later handlers', async () => {
    const terminal = vi.fn(() => 'unexpected')
    const getHandler = vi.fn(() => 'get')
    const post = vi.fn(async (_c, next) => next())
    const onResponse = vi.fn()
    const app = createHonoApp([
      route('GET', '/early', getHandler),
      route('HEAD', '/early', terminal, { middlewares: [
        { source: 'pre.ts', index: 0, position: 'pre', handle: async c => c.text('early', 203, { 'x-early': 'yes' }) },
        { source: 'post.ts', index: 1, position: 'post', handle: post },
      ] }),
    ], { onResponse })
    const response = await app.request('/early', { method: 'HEAD' })
    expect(response.status).toBe(203)
    expect(response.headers.get('x-early')).toBe('yes')
    expect(await response.text()).toBe('')
    expect(terminal).not.toHaveBeenCalled()
    expect(getHandler).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(onResponse).toHaveBeenCalledTimes(1)
  })

  it('retains explicit HEAD handlers when the Fetch server mounts its mock app', async () => {
    const app = buildFetchServerApp({
      routes: [route('GET', '/ping', 'get'), route('HEAD', '/ping', 'head', { headers: { 'x-route': 'head' } })],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      dirs: [],
      root: '/',
      playground: { enabled: false, path: '/__mokup' },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    const response = await app.fetch(new Request('http://localhost/ping', { method: 'HEAD' }))
    expect(response.headers.get('x-route')).toBe('head')
    expect(await response.text()).toBe('')
  })

  it.each(['HEAD', 'GET'] as const)('cancels streamed %s bodies and finalizes response hooks after parent mounting', async (method) => {
    const cancel = vi.fn()
    const onResponse = vi.fn()
    const child = createHonoApp([
      route(method, '/stream', () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('payload'))
        },
        cancel,
      }), { headers: { 'content-length': '7' } })),
    ], { onResponse })
    child.onError((_error, c) => c.text('error', 500))
    const app = new Hono().route('/mounted', child)
    const response = await app.request('/mounted/stream', { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('7')
    expect(response.body).toBeNull()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(onResponse).toHaveBeenCalledTimes(1)
    expect(onResponse.mock.calls[0]?.[1].body).toBeNull()
  })
})
