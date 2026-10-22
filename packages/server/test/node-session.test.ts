import type { ServerOptions } from '../src/types'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { http, HttpResponse, passthrough } from '@mokup/runtime/http'
import Fastify from 'fastify'
import Koa from 'koa'
import { describe, expect, it, vi } from 'vitest'
import { createConnectMiddleware } from '../src/connect'
import { createExpressMiddleware } from '../src/express'
import { createFastifyPlugin } from '../src/fastify'
import { createKoaMiddleware } from '../src/koa'

type Adapter = 'Connect' | 'Express' | 'Koa' | 'Fastify'

async function fixture(kind: Adapter, options: ServerOptions) {
  if (kind === 'Fastify') {
    const app = Fastify()
    const adapter = createFastifyPlugin(options)
    await app.register(adapter)
    app.post('/native', async req => req.body)
    const url = await app.listen({ host: '127.0.0.1', port: 0 })
    return { url, adapter, async close() {
      await adapter.close()
      app.server.closeAllConnections()
      await app.close()
    } }
  }
  const koa = new Koa()
  const adapter = kind === 'Koa' ? createKoaMiddleware(options) : undefined
  const connect = kind === 'Koa' ? undefined : kind === 'Connect' ? createConnectMiddleware(options) : createExpressMiddleware(options)
  if (adapter) {
    koa.use(adapter)
    koa.use(async c => c.body = Buffer.concat(await Array.fromAsync(c.req)))
  }
  const server = createServer(adapter
    ? koa.callback()
    : (req, res) => {
        void connect!(req, res, (error) => {
          if (error) {
            res.statusCode = 500
            res.end(String(error))
          }
          else {
            req.pipe(res)
          }
        })
      })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new TypeError('Expected an HTTP server address')
  }
  const controls = adapter ?? connect!
  return { url: `http://127.0.0.1:${address.port}`, adapter: controls, async close() {
    await controls.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  } }
}

const manifest: ServerOptions['manifest'] = { version: 1, routes: [
  { method: 'GET', url: '/base', response: { type: 'text', body: 'file' } },
] }

describe.each(['Connect', 'Express', 'Koa', 'Fastify'] as const)('%s shared Node session', (kind) => {
  it('dispatches native handlers outside the manifest and shares override controls', async () => {
    const app = await fixture(kind, { manifest, handlers: [http.get('/extra', () => HttpResponse.text('initial'))] })
    const send = async (path: string) => (await fetch(`${app.url}${path}`)).text()
    try {
      app.adapter.use(http.get(`${app.url}/base`, () => HttpResponse.text('once'), { once: true }))
      expect(await send('/base')).toBe('once')
      expect(await send('/base')).toBe('file')
      app.adapter.restoreHandlers()
      expect(await send('/base')).toBe('once')
      app.adapter.resetHandlers()
      expect(await send('/base')).toBe('file')
      expect(await send('/extra')).toBe('initial')
      expect(await app.adapter.listHandlers()).toHaveLength(2)
    }
    finally {
      await app.close()
    }
  })

  it('preserves downstream POST parsing after a predicate and resolver consume body copies', async () => {
    const payload = JSON.stringify({ role: 'admin', value: '原始内容' })
    const app = await fixture(kind, {
      manifest,
      handlers: [http.post(async ({ request }) => (await request.json()).role === 'admin', async ({ request }) => {
        expect(await request.text()).toBe(payload)
        return passthrough()
      })],
      onUnhandled: 'error',
    })
    try {
      const response = await fetch(`${app.url}/native`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(JSON.parse(payload))
    }
    finally {
      await app.close()
    }
  })

  it('emits miss events and enforces policies for paths outside the manifest', async () => {
    const policy = vi.fn()
    const app = await fixture(kind, { manifest, onUnhandled: policy })
    const events: { type: string, id: string }[] = []
    for (const type of ['request:start', 'request:unhandled', 'response:bypass', 'request:end'] as const) {
      app.adapter.events.on(type, event => events.push({ type, id: event.requestId }))
    }
    try {
      await fetch(`${app.url}/miss`)
      expect(policy).toHaveBeenCalledOnce()
      expect(events.map(event => event.type)).toEqual(['request:start', 'request:unhandled', 'response:bypass', 'request:end'])
      expect(new Set(events.map(event => event.id)).size).toBe(1)
      app.adapter.setOnUnhandled('error')
      expect((await fetch(`${app.url}/error`)).status).toBe(500)
    }
    finally {
      await app.close()
    }
  })

  it.each(['client', 'session'] as const)('streams a response immediately and cancels it on %s closure', async (operation) => {
    const cancel = vi.fn()
    const finalized = vi.fn()
    const app = await fixture(kind, { manifest, handlers: [http.get('/stream', ({ finalize }) => {
      finalize(finalized)
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('first')) },
        cancel,
      }))
    })] })
    const controller = new AbortController()
    try {
      const response = await fetch(`${app.url}/stream`, { signal: controller.signal })
      const reader = response.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
      if (operation === 'client') {
        controller.abort()
      }
      else {
        await app.adapter.close()
      }
      await expect(reader.read()).rejects.toThrow()
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
      expect(finalized).toHaveBeenCalledOnce()
    }
    finally {
      await app.close()
    }
  })
})

it('automatically closes the Fastify session when its application closes', async () => {
  const app = Fastify()
  const adapter = createFastifyPlugin({ manifest })
  await app.register(adapter)
  const session = await adapter.ready()
  try {
    expect(session.signal.aborted).toBe(false)
    await app.close()
    expect(session.signal.aborted).toBe(true)
    await expect(adapter.ready()).rejects.toThrow('closed')
  }
  finally {
    await app.close()
    await adapter.close()
  }
})
