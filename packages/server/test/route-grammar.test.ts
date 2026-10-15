import type { Context } from '@mokup/shared/hono'
import type { ResolvedRoute } from '../src/dev/types'
import { parseRouteTemplate } from '@mokup/runtime'
import { Hono } from '@mokup/shared/hono'
import { describe, expect, it, vi } from 'vitest'
import { createHonoApp } from '../src/dev/hono'

function route(method: 'GET' | 'HEAD', path: string, handler: ResolvedRoute['handler'], extra: Partial<ResolvedRoute> = {}): ResolvedRoute {
  const parsed = parseRouteTemplate(path)
  expect(parsed.errors).toEqual([])
  return { method, file: `${path}.${method}.ts`, template: parsed.template, tokens: parsed.tokens, score: parsed.score, handler, ...extra }
}

describe('server route grammar boundary', () => {
  it('preserves original parameter names and parent params throughout mounted GET and HEAD chains', async () => {
    const seen: Array<{ stage: string, method: string, single: string | null, all: Record<string, string> }> = []
    const snapshot = (stage: string, c: Context) => ({ stage, method: c.req.method, single: c.req.param('user-id') ?? null, all: c.req.param() })
    const onResponse = vi.fn()
    const child = createHonoApp((['GET', 'HEAD'] as const).map(method => route(method, '/users/[user-id]/[123]', (c: Context) => {
      seen.push(snapshot('handler', c))
      return method
    }, {
      status: method === 'HEAD' ? 202 : 201,
      headers: { 'x-route': method },
      middlewares: [{
        source: 'index.config.ts',
        index: 0,
        position: 'pre',
        handle: async (c, next) => {
          seen.push(snapshot('before', c))
          await next()
          seen.push(snapshot('after', c))
        },
      }],
    })), { onResponse })
    child.onError((_error, c) => c.text('unexpected error', 500))
    const app = new Hono().route('/mounted/:tenant', child)
    app.get('/health', c => c.text('healthy'))

    expect(await (await app.request('/health')).text()).toBe('healthy')
    for (const method of ['HEAD', 'GET']) {
      seen.length = 0
      onResponse.mockClear()
      const response = await app.request('/mounted/team/users/a%252Fb/7', { method })
      expect(response.status).toBe(method === 'HEAD' ? 202 : 201)
      expect(response.headers.get('x-route')).toBe(method)
      expect(await response.text()).toBe(method === 'HEAD' ? '' : 'GET')
      const expected = { method, single: 'a%2Fb', all: { 'tenant': 'team', 'user-id': 'a%2Fb', '123': '7' } }
      expect(seen).toEqual(['before', 'handler', 'after'].map(stage => ({ stage, ...expected })))
      expect(onResponse).toHaveBeenCalledOnce()
      expect(onResponse.mock.calls[0]?.[0].method).toBe(method)
      expect(onResponse.mock.calls[0]?.[1].headers.get('x-route')).toBe(method)
    }
  })

  it('keeps static metacharacters literal after mounting and reports the selected route', async () => {
    const literals = [':reserved', 'foo*', 'a{2}', 'a|b']
    const onResponse = vi.fn()
    const child = createHonoApp([
      ...literals.map(value => route('GET', `/literal/${value}`, value, { status: 201, headers: { 'x-route': value } })),
      route('GET', '/literal/[id]', 'dynamic', { status: 202, headers: { 'x-route': 'dynamic' } }),
      route('GET', '/health', 'healthy'),
    ], { onResponse })
    const app = new Hono().route('/mounted', child)
    for (const [value, selected] of [
      ...literals.map(value => [value, value]),
      ...['other', 'foox', 'aa', 'a', 'b'].map(value => [value, 'dynamic']),
    ]) {
      onResponse.mockClear()
      const response = await app.request(`/mounted/literal/${value}`)
      expect(response.status).toBe(selected === 'dynamic' ? 202 : 201)
      expect(response.headers.get('x-route')).toBe(selected)
      expect(await response.text()).toBe(selected)
      expect(onResponse).toHaveBeenCalledOnce()
      expect(onResponse.mock.calls[0]?.[0].headers['x-route']).toBe(selected)
    }
    expect(await (await app.request('/mounted/health')).text()).toBe('healthy')
    expect((await app.request('/unrelated-b')).status).toBe(404)
  })

  it.each([
    ['/repeat/[id]/[id]', '/repeat/first/last', 'last'],
    ['/repeat/[id]/[...id]', '/repeat/first/last/tail', 'last/tail'],
    ['/repeat/[id]/[[...id]]', '/repeat/first', null],
    ['/repeat/[id]/[[...id]]', '/repeat/first/last/tail', 'last/tail'],
  ])('uses the final occurrence of a repeated name in %s', async (template, path, value) => {
    const app = createHonoApp([route('GET', template!, c => ({ single: c.req.param('id') ?? null, all: c.req.param() }))])
    const response = await app.request(path!)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ single: value, all: value === null ? {} : { id: value } })
  })
})
