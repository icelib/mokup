import { describe, expect, it } from 'vitest'
import { setupWorker } from '../src/browser'
import { delay, http, HttpMethods, HttpResponse, networkError, passthrough } from '../src/index'
import { setupServer } from '../src/node'
import { normalizeOptions } from '../src/options'

describe('HTTP import migration facade', () => {
  it('provides the common MSW HTTP method alias', () => {
    expect(HttpMethods).toMatchObject({ GET: 'GET', POST: 'POST', DELETE: 'DELETE' })
  })

  it('runs a real fetch through facade definitions, overrides and reset', async () => {
    const server = setupServer(http.get('https://migration.test/users/:id', ({ params }) => HttpResponse.json({ id: params['id'] })))
    server.listen({ onUnhandledFrame: 'error' })
    try {
      expect(server.readyState).toBe('started')
      expect(await (await fetch('https://migration.test/users/42')).json()).toEqual({ id: '42' })
      server.use(http.get('https://migration.test/users/:id', () => HttpResponse.json({ error: 'temporary' }, { status: 503 }), { once: true }))
      expect((await fetch('https://migration.test/users/42')).status).toBe(503)
      expect((await fetch('https://migration.test/users/42')).status).toBe(200)
      server.restoreHandlers()
      expect((await fetch('https://migration.test/users/42')).status).toBe(503)
      server.resetHandlers()
      expect(await (await fetch('https://migration.test/users/42')).json()).toEqual({ id: '42' })
      await expect(fetch('https://migration.test/missing')).rejects.toThrow()
    }
    finally {
      await server.close()
    }
    expect(server.readyState).toBe('stopped')
  })

  it('exposes MSW lifecycle payloads without consuming the mocked request or response', async () => {
    const server = setupServer(http.post('https://migration.test/events', async ({ request }) => {
      return HttpResponse.json({ body: await request.json() })
    }))
    const starts: Array<{ request: Request, requestId: string }> = []
    const mocked: Array<{ request: Request, response: Response, requestId: string }> = []
    server.events.on('request:start', event => starts.push(event))
    server.events.on('response:mocked', event => mocked.push(event))
    server.listen({ onUnhandledFrame: 'error' })
    try {
      expect(await (await fetch('https://migration.test/events', { method: 'POST', body: '{"ok":true}' })).json()).toEqual({ body: { ok: true } })
      expect(starts).toHaveLength(1)
      expect(starts[0]!.requestId).toBe(mocked[0]!.requestId)
      expect(await starts[0]!.request.clone().json()).toEqual({ ok: true })
      expect(mocked[0]!.response.status).toBe(200)
      expect(mocked[0]!.response.headers.get('content-type')).toContain('application/json')
      expect(await mocked[0]!.response.text()).toBe('')
    }
    finally {
      await server.close()
    }
  })

  it('keeps the browser entry independent and reports its interceptor mode', async () => {
    const worker = setupWorker(http.post('https://browser-migration.test/echo', async ({ request }) => {
      await delay(0, { signal: request.signal })
      return HttpResponse.json(await request.json())
    }))
    await worker.start({ onUnhandledRequest: 'error', mode: 'interceptor' })
    try {
      expect(worker.mode).toBe('interceptor')
      expect(worker.readyState).toBe('started')
      const response = await fetch('https://browser-migration.test/echo', { method: 'POST', body: '{"ok":true}' })
      expect(await response.json()).toEqual({ ok: true })
    }
    finally {
      await worker.stop()
    }
    expect(worker.readyState).toBe('stopped')
  })

  it('exports explicit passthrough and network error results', () => {
    expect(passthrough()).toEqual({ kind: 'mokup:passthrough' })
    expect(networkError().type).toBe('error')
  })

  it('rejects unsupported MSW options and foreign handler objects', async () => {
    const server = setupServer()
    expect(() => server.listen({ onUnhandledRequest: 'invalid' } as never)).toThrow('strategy or callback')
    expect(() => server.listen({ onUnhandledFrame: 'invalid' } as never)).toThrow('strategy or callback')
    expect(() => server.listen({ onUnhandledFrame: 'error', onUnhandledRequest: 'warn' })).toThrow('conflicting')
    expect(() => setupServer({ info: { method: 'GET' } } as never)).toThrow('HTTP handlers')
    expect(() => server.use({ info: { method: 'GET' } } as never)).toThrow('HTTP handlers')
    const worker = setupWorker()
    await expect(worker.start({ quiet: true } as never)).rejects.toThrow('quiet')
  })

  it('uses MSW 3 warning defaults and retains the MSW 2 string policy alias', () => {
    expect(normalizeOptions()).toEqual({ onUnhandled: 'warn' })
    expect(normalizeOptions({ onUnhandledFrame: 'bypass' })).toEqual({ onUnhandled: 'bypass' })
    expect(normalizeOptions({ onUnhandledRequest: 'error' })).toEqual({ onUnhandled: 'error' })
    expect(normalizeOptions({ onUnhandledFrame: 'error', onUnhandledRequest: 'error' })).toEqual({ onUnhandled: 'error' })
  })
})
