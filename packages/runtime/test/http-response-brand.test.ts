import { once } from 'node:events'
import { serve } from '@hono/node-server'
import { describe, expect, it } from 'vitest'
import { createMockSession, http, HttpResponse } from '../src/http'
import { isResponse } from '../src/http/is-response'
import { createRuntime } from '../src/runtime'

describe('Fetch response identity', () => {
  it('accepts HttpResponse imported before Hono replaces global Fetch constructors', async () => {
    const OriginalRequest = globalThis.Request
    const OriginalResponse = globalThis.Response
    const server = serve({ fetch: () => new OriginalResponse('native'), port: 0, hostname: '127.0.0.1' })
    const session = createMockSession(http.get('/brand', () => HttpResponse.text('mocked', { status: 201 })))
    try {
      await once(server, 'listening')
      expect(globalThis.Response).not.toBe(OriginalResponse)
      const result = await session.handle(new OriginalRequest('http://example.test/brand'))
      expect(result?.status).toBe(201)
      expect(await result?.text()).toBe('mocked')
      const runtime = createRuntime({
        manifest: { version: 1, routes: [{ method: 'GET', url: '/legacy', response: { type: 'module', module: './legacy' } }] },
        moduleMap: { './legacy': { default: () => HttpResponse.text('legacy', { status: 202 }) } },
      })
      try {
        expect(await runtime.handle({ method: 'GET', path: '/legacy', query: {}, headers: {}, body: undefined })).toMatchObject({ status: 202, body: 'legacy' })
      }
      finally {
        await runtime.close()
      }
    }
    finally {
      await session.dispose()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      globalThis.Request = OriginalRequest
      globalThis.Response = OriginalResponse
    }
  })

  it('rejects response lookalikes with forged tags', () => {
    expect(isResponse({ status: 200, headers: new Headers(), body: null, [Symbol.toStringTag]: 'Response' })).toBe(false)
  })
})
