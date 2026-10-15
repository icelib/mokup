import { describe, expect, it } from 'vitest'
import { compileRoutes } from '../src/runtime/routes'

const baseResponse = { type: 'text', body: 'ok' } as const

describe('runtime route compilation', () => {
  it('compiles routes and skips invalid templates', () => {
    const manifest = {
      version: 1,
      routes: [
        { method: 'get', url: '/users/[id]', response: baseResponse },
        { method: undefined as unknown as string, url: '/fallback', response: baseResponse },
        { method: 'POST', url: '/posts', response: baseResponse },
        { method: 'GET', url: '/[...slug]/extra', response: baseResponse },
        {
          method: 'PUT',
          url: '/tokens',
          tokens: [{ type: 'static', value: 'tokens' }],
          score: [4],
          response: baseResponse,
        },
      ],
    }

    const compiled = compileRoutes(manifest)
    expect(compiled.some(entry => entry.route.url === '/[...slug]/extra')).toBe(false)
    expect(compiled.some(entry => entry.method === 'GET')).toBe(true)
    expect(compiled.some(entry => entry.method === 'POST')).toBe(true)
    expect(compiled.some(entry => entry.route.url === '/fallback' && entry.method === 'GET')).toBe(true)
  })
})
