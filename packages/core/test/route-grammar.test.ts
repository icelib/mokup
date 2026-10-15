import type { Context } from '@mokup/shared/hono'
import type { ResolvedRoute } from '../src/shared/types'
import { parseRouteTemplate } from '@mokup/runtime'
import { describe, expect, it } from 'vitest'
import { createHonoApp } from '../src/middleware'

function route(path: string, handler: ResolvedRoute['handler'], extra: Partial<ResolvedRoute> = {}): ResolvedRoute {
  const parsed = parseRouteTemplate(path)
  expect(parsed.errors).toEqual([])
  return { method: 'GET', file: `${path}.get.ts`, template: parsed.template, tokens: parsed.tokens, score: parsed.score, handler, ...extra }
}

describe('core route grammar boundary', () => {
  it('keeps valid parameter names usable in handlers and the complete middleware chain', async () => {
    const cases: Array<{ template: string, path: string, name: string, value: string | null }> = [
      { template: '/users/[user-id]', path: '/users/42', name: 'user-id', value: '42' },
      { template: '/digits/[123]', path: '/digits/7', name: '123', value: '7' },
      { template: '/repeat/[id]/[id]', path: '/repeat/first/last', name: 'id', value: 'last' },
      { template: '/files/[...file-path]', path: '/files/a/b', name: 'file-path', value: 'a/b' },
      { template: '/docs/[[...rest-path]]', path: '/docs', name: 'rest-path', value: null },
      { template: '/optional/[id]/[[...id]]', path: '/optional/first', name: 'id', value: null },
      { template: '/optional/[id]/[[...id]]', path: '/optional/first/last/tail', name: 'id', value: 'last/tail' },
    ]
    const seen: Array<{ stage: string, single: string | null, all: Record<string, string> }> = []
    const uniqueCases = cases.filter((entry, index) => cases.findIndex(other => other.template === entry.template) === index)
    const app = createHonoApp([
      ...uniqueCases.map(entry => route(entry.template, (c: Context) => ({ single: c.req.param(entry.name) ?? null, all: c.req.param() }), {
        headers: { 'x-route': entry.template },
        middlewares: [{
          source: 'index.config.ts',
          index: 0,
          position: 'pre',
          handle: async (c, next) => {
            seen.push({ stage: 'before', single: c.req.param(entry.name) ?? null, all: c.req.param() })
            await next()
            seen.push({ stage: 'after', single: c.req.param(entry.name) ?? null, all: c.req.param() })
          },
        }],
      })),
      route('/health', 'healthy'),
    ])

    expect(await (await app.request('/health')).text()).toBe('healthy')
    for (const entry of cases) {
      seen.length = 0
      const response = await app.request(entry.path)
      const expected = { single: entry.value, all: entry.value === null ? {} : { [entry.name]: entry.value } }
      expect(response.status, entry.path).toBe(200)
      expect(response.headers.get('x-route')).toBe(entry.template)
      expect(await response.json()).toEqual(expected)
      expect(seen).toEqual([{ stage: 'before', ...expected }, { stage: 'after', ...expected }])
    }
  })

  it('matches static punctuation literally and keeps response overrides with the selected handler', async () => {
    const literals = [':reserved', 'foo*', 'a{2}', 'a|b']
    const app = createHonoApp([
      ...literals.map(value => route(`/literal/${value}`, value, { status: 201, headers: { 'x-route': value } })),
      route('/literal/[id]', 'dynamic', { status: 202, headers: { 'x-route': 'dynamic' } }),
      route('/health', 'healthy', { headers: { 'x-route': 'health' } }),
    ])
    for (const value of literals) {
      const response = await app.request(`/literal/${value}`)
      expect(response.status).toBe(201)
      expect(response.headers.get('x-route')).toBe(value)
      expect(await response.text()).toBe(value)
    }
    for (const value of ['other', 'foox', 'aa', 'a', 'b']) {
      const response = await app.request(`/literal/${value}`)
      expect(response.status).toBe(202)
      expect(response.headers.get('x-route')).toBe('dynamic')
      expect(await response.text()).toBe('dynamic')
    }
    expect(await (await app.request('/health')).text()).toBe('healthy')
    expect((await app.request('/unrelated-b')).status).toBe(404)
  })

  it.each([
    ['hello%20world', 'hello world'],
    ['a%2Fb', 'a/b'],
    ['a%252Fb', 'a%2Fb'],
    ['%E9%9B%AA', '雪'],
    ['%E0', '%E0'],
  ])('decodes %s once while restoring the original parameter name', async (encoded, decoded) => {
    const app = createHonoApp([route('/encoded/[user-id]', c => ({ single: c.req.param('user-id'), all: c.req.param() }))])
    const response = await app.request(`/encoded/${encoded}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ single: decoded, all: { 'user-id': decoded } })
  })
})
