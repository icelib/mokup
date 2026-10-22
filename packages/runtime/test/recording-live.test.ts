import { describe, expect, it } from 'vitest'
import { importOpenApi } from '../src/contract'
import { compareLive, diffRecordedInteractions } from '../src/recording'

describe('live mock comparison', () => {
  it('ignores HTTP transport metadata while preserving the recorded fixtures', async () => {
    const date = 'Thu, 22 Oct 2026 08:00:00 GMT'
    const result = await compareLive(new Request('https://api.example.test/value'), {
      mock: () => Response.json({ ok: true }),
      real: () => Response.json({ ok: true }, {
        statusText: 'OK',
        headers: {
          'date': date,
          'connection': 'keep-alive, X-Transport',
          'keep-alive': 'timeout=5',
          'x-transport': 'connection-specific',
          'transfer-encoding': 'chunked',
        },
      }),
    })

    expect(result.equal).toBe(true)
    expect(result.diff).toEqual({ equal: true, differences: [], truncated: false })
    expect(result.mock.fixture?.response.statusText).toBe('')
    expect(result.real.fixture?.response.statusText).toBe('OK')
    expect(new Headers(result.real.fixture?.response.headers).get('date')).toBe(date)
    expect(new Headers(result.real.fixture?.response.headers).get('x-transport')).toBe('connection-specific')
    expect(diffRecordedInteractions(result.mock.fixture!, result.real.fixture!).equal).toBe(false)
  })

  it('still reports application header, status and body differences', async () => {
    const result = await compareLive(new Request('https://api.example.test/value'), {
      mock: () => Response.json({ value: 'mock' }, {
        headers: { 'cache-control': 'no-store', 'x-api-revision': '1' },
      }),
      real: () => Response.json({ value: 'real' }, {
        status: 201,
        statusText: 'Created',
        headers: { 'cache-control': 'max-age=60', 'x-api-revision': '2', 'date': new Date().toUTCString() },
      }),
    })

    expect(result.equal).toBe(false)
    expect(result.diff?.differences).toEqual([
      { path: '/response/body/value/value', kind: 'changed', expected: 'mock', actual: 'real' },
      { path: '/response/headers/cache-control/0', kind: 'changed', expected: 'no-store', actual: 'max-age=60' },
      { path: '/response/headers/x-api-revision/0', kind: 'changed', expected: '1', actual: '2' },
      { path: '/response/status', kind: 'changed', expected: 200, actual: 201 },
    ])
  })

  it('uses independent request and response clones, redacts both sides, and reports fixture differences', async () => {
    const request = new Request('https://api.example.test/users?token=REQUEST_SECRET', {
      method: 'POST',
      headers: { 'authorization': 'Bearer HEADER_SECRET', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada' }),
    })
    const result = await compareLive(request, {
      mock: async (input) => {
        expect(await input.json()).toEqual({ name: 'Ada' })
        return new Response(JSON.stringify({ id: 1, token: 'MOCK_SECRET' }), { headers: { 'content-type': 'application/json' } })
      },
      real: async (input) => {
        expect(await input.json()).toEqual({ name: 'Ada' })
        return new Response(JSON.stringify({ id: 2, token: 'REAL_SECRET' }), { headers: { 'content-type': 'application/json' } })
      },
    }, { redact: { query: ['token'], jsonPointers: ['/token'] } })

    expect(await request.clone().json()).toEqual({ name: 'Ada' })
    expect(result.equal).toBe(false)
    expect(result.request.url).toBe('https://api.example.test/users?token=%5BREDACTED%5D')
    expect(result.diff?.differences).toEqual([{ path: '/response/body/value/id', kind: 'changed', expected: 1, actual: 2 }])
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })

  it('marks bypasses and handler failures without consuming the real response', async () => {
    const response = new Response('real')
    const result = await compareLive(new Request('https://api.example.test/value'), {
      mock: () => undefined,
      real: () => response,
    })
    expect(result.equal).toBe(false)
    expect(result.mock.error?.message).toContain('bypassed')
    expect(await response.text()).toBe('real')

    const failed = await compareLive(new Request('https://api.example.test/value'), {
      mock: () => { throw new Error('mock failed') },
      real: () => new Response('real'),
    })
    expect(failed.mock.error).toEqual({ message: 'mock failed' })
    expect(failed.real.fixture?.response.status).toBe(200)
  })

  it('adds OpenAPI validation to a live response comparison', async () => {
    const [operation] = importOpenApi({
      openapi: '3.0.0',
      info: { title: 'Live comparison', version: '1' },
      paths: {
        '/users': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
                  },
                },
              },
            },
          },
        },
      },
    })
    const result = await compareLive(new Request('https://api.example.test/users'), {
      mock: () => new Response(JSON.stringify({ id: 1 }), { headers: { 'content-type': 'application/json' } }),
      real: () => new Response(JSON.stringify({ id: 'wrong' }), { headers: { 'content-type': 'application/json' } }),
    }, { contract: operation })
    expect(result.equal).toBe(false)
    expect(result.contract?.expected.valid).toBe(true)
    expect(result.contract?.actual.valid).toBe(false)
    expect(result.contract?.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'invalid', side: 'actual', path: '/id' }),
    ]))
  })
})
