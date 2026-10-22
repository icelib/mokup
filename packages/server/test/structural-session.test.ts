import type { NodeRequestLike } from '../src/internal'
import type { ServerOptions } from '../src/types'
import { PassThrough } from 'node:stream'
import { http, HttpResponse, passthrough } from '@mokup/runtime/http'
import { describe, expect, it, vi } from 'vitest'
import { createConnectMiddleware } from '../src/connect'
import { createExpressMiddleware } from '../src/express'
import { createFastifyPlugin } from '../src/fastify'
import { toRuntimeRequestFromNode } from '../src/internal/request'
import { createKoaMiddleware } from '../src/koa'

type Kind = 'Connect' | 'Express' | 'Koa' | 'Fastify'

async function fixture(kind: Kind, options: ServerOptions) {
  const koa = kind === 'Koa' ? createKoaMiddleware(options) : undefined
  const plugin = kind === 'Fastify' ? createFastifyPlugin(options) : undefined
  const connect = kind === 'Connect' ? createConnectMiddleware(options) : kind === 'Express' ? createExpressMiddleware(options) : undefined
  let hook: ((req: NodeRequestLike, reply: any) => Promise<void> | void) | undefined
  if (plugin) {
    await plugin({ addHook: (_name, handler) => {
      hook = handler
    } })
  }
  const controls = koa ?? plugin ?? connect!
  return { controls, async send(req: NodeRequestLike) {
    let body: unknown
    let status = 200
    let fellThrough = false
    if (koa) {
      const context = { req, status, body, set: vi.fn() }
      await koa(context, async () => {
        fellThrough = true
      })
      body = context.body
      status = context.status
    }
    else if (hook) {
      const reply = {
        status(code: number) {
          status = code
          return reply
        },
        header() { return reply },
        send(value?: unknown) { body = value },
      }
      await hook(req, reply)
      fellThrough = body === undefined && status === 200
    }
    else {
      const response = { statusCode: status, setHeader: vi.fn(), end(value?: unknown) {
        body = value
      } }
      await connect!(req, response, (error) => {
        if (error) {
          throw error
        }
        fellThrough = true
      })
      status = response.statusCode
    }
    return { body, status, fellThrough }
  } }
}

function request(path: string, body?: unknown): NodeRequestLike {
  return { method: body === undefined ? 'GET' : 'POST', url: path, headers: { 'host': 'example.com', 'content-type': 'application/json' }, body, on: vi.fn() }
}

describe.each(['Connect', 'Express', 'Koa', 'Fastify'] as const)('%s structural session', (kind) => {
  it('shares dynamic definitions, original URLs and once/reset/restore controls', async () => {
    const app = await fixture(kind, {
      manifest: { version: 1, routes: [{ method: 'GET', url: '/file', response: { type: 'text', body: 'file' } }] },
      handlers: [http.get('http://example.com/extra', ({ request }) => HttpResponse.text(request.url))],
    })
    try {
      app.controls.use(http.get('/file', () => HttpResponse.text('once'), { once: true }))
      expect((await app.send(request('/file'))).body).toBe('once')
      expect((await app.send(request('/file'))).body).toBe('file')
      app.controls.restoreHandlers()
      expect((await app.send(request('/file'))).body).toBe('once')
      app.controls.resetHandlers()
      expect((await app.send(request('/file'))).body).toBe('file')
      expect((await app.send(request('/extra?x=1&x=2'))).body).toBe('http://example.com/extra?x=1&x=2')
    }
    finally {
      await app.controls.close()
    }
  })

  it('applies miss policies and events without inspecting an unmatched upload', async () => {
    const policy = vi.fn()
    const app = await fixture(kind, { manifest: { version: 1, routes: [] }, onUnhandled: policy })
    const types: string[] = []
    for (const type of ['request:start', 'request:unhandled', 'response:bypass', 'request:end'] as const) {
      app.controls.events.on(type, () => types.push(type))
    }
    const read = vi.fn(() => {
      throw new Error('Unmatched upload was read')
    })
    const req = { ...request('/missing'), method: 'POST', get body() {
      return read()
    } }
    try {
      expect((await app.send(req)).fellThrough).toBe(true)
      expect(policy).toHaveBeenCalledOnce()
      expect(types).toEqual(['request:start', 'request:unhandled', 'response:bypass', 'request:end'])
      expect(read).not.toHaveBeenCalled()
      app.controls.setOnUnhandled('error')
      await expect(app.send(req)).rejects.toThrow('Unhandled request')
      expect(read).not.toHaveBeenCalled()
    }
    finally {
      await app.controls.close()
    }
  })

  it('retains raw bytes after predicates and resolvers read independent upload copies', async () => {
    const bytes = new Uint8Array([0, 255, 128, 65])
    const app = await fixture(kind, {
      manifest: { version: 1, routes: [] },
      handlers: [http.post(async ({ request }) => {
        expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes)
        return true
      }, async ({ request }) => {
        expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes)
        return passthrough()
      })],
      onUnhandled: 'error',
    })
    const stream = Object.assign(new PassThrough(), { method: 'POST', url: '/native', headers: { host: 'example.com' }, body: undefined as unknown })
    try {
      const pending = app.send(stream)
      stream.end(bytes)
      expect((await pending).fellThrough).toBe(true)
      expect((await toRuntimeRequestFromNode(stream)).rawBodyBytes).toEqual(bytes)
    }
    finally {
      stream.destroy()
      await app.controls.close()
    }
  })

  it('releases upload listeners when a session closes while waiting for a body', async () => {
    const app = await fixture(kind, { manifest: { version: 1, routes: [] }, handlers: [http.post('/upload', () => HttpResponse.text('ok'))] })
    const stream = Object.assign(new PassThrough(), { method: 'POST', url: '/upload' })
    const pending = app.send(stream)
    const rejected = expect(pending).rejects.toThrow('disposed')
    try {
      await vi.waitFor(() => expect(stream.listenerCount('data')).toBe(1))
      await app.controls.close()
      await rejected
      expect(stream.listenerCount('data')).toBe(0)
      expect(stream.listenerCount('end')).toBe(0)
    }
    finally {
      stream.destroy()
      await app.controls.close()
    }
  })
})
