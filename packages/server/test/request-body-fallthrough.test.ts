import type { RequestHandler } from '@mokup/runtime'
import type { IncomingMessage, Server } from 'node:http'
import type { ServerOptions } from '../src/types'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { Hono } from '@mokup/shared/hono'
import Fastify from 'fastify'
import Koa from 'koa'
import { describe, expect, it } from 'vitest'
import { createConnectMiddleware } from '../src/connect'
import { createExpressMiddleware } from '../src/express'
import { createFastifyPlugin } from '../src/fastify'
import { createFetchHandler } from '../src/fetch'
import { createHonoMiddleware } from '../src/hono'
import { createKoaMiddleware } from '../src/koa'

const payload = { message: '完整 body ☃', values: [1, 2, 3] }
const rawPayload = JSON.stringify(payload)
const unmatchedPaths = ['/native', '/method-only']

function createOptions(): ServerOptions {
  const handler: RequestHandler = async context => ({
    body: await context.req.json(),
    id: context.req.param('id') ?? null,
  })
  return {
    manifest: {
      version: 1,
      routes: [
        { method: 'POST', url: '/mock', response: { type: 'module', module: 'mock:echo' } },
        { method: 'POST', url: '/dynamic/[id]', response: { type: 'module', module: 'mock:echo' } },
        { method: 'GET', url: '/method-only', response: { type: 'text', body: 'GET mock' } },
      ],
    },
    moduleMap: { 'mock:echo': { default: { handler } } },
  }
}

async function readIncoming(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function postJson(url: URL): Promise<{ status: number | undefined, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(rawPayload) },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.once('error', reject)
      res.once('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.setTimeout(1500, () => req.destroy(new Error('POST response timed out after middleware fallthrough')))
    req.once('error', reject)
    const bytes = Buffer.from(rawPayload)
    req.write(bytes.subarray(0, 7))
    req.end(bytes.subarray(7))
  })
}

async function listen(server: Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address')
  }
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
}

function createFetchRequest(path: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawPayload,
  })
}

describe('request body ownership across adapter fallthrough', () => {
  it.each([
    ['Connect', createConnectMiddleware],
    ['Express', createExpressMiddleware],
  ] as const)('%s leaves unmatched HTTP streams for downstream consumers', async (_name, createMiddleware) => {
    const middleware = createMiddleware(createOptions())
    const server = createServer((req, res) => {
      void middleware(req, res, (error) => {
        if (error) {
          res.statusCode = 500
          res.end(String(error))
          return
        }
        const endedBeforeDownstream = req.readableEnded
        void readIncoming(req).then((raw) => {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ raw, endedBeforeDownstream }))
        }).catch((readError) => {
          res.statusCode = 500
          res.end(String(readError))
        })
      })
    })
    try {
      const origin = await listen(server)
      const matched = await postJson(new URL('/mock', origin))
      expect(matched.status).toBe(200)
      expect(JSON.parse(matched.body)).toEqual({ body: payload, id: null })
      for (const path of unmatchedPaths) {
        const response = await postJson(new URL(path, origin))
        expect(response.status).toBe(200)
        expect(JSON.parse(response.body)).toEqual({ raw: rawPayload, endedBeforeDownstream: false })
      }
    }
    finally {
      await close(server)
    }
  })

  it('leaves unmatched Koa request streams readable by downstream middleware', async () => {
    const app = new Koa()
    app.use(createKoaMiddleware(createOptions()))
    app.use(async (context) => {
      const endedBeforeDownstream = context.req.readableEnded
      context.body = { raw: await readIncoming(context.req), endedBeforeDownstream }
    })
    const server = createServer(app.callback())
    try {
      const origin = await listen(server)
      const matched = await postJson(new URL('/mock', origin))
      expect(matched.status).toBe(200)
      expect(JSON.parse(matched.body)).toEqual({ body: payload, id: null })
      for (const path of unmatchedPaths) {
        const response = await postJson(new URL(path, origin))
        expect(response.status).toBe(200)
        expect(JSON.parse(response.body)).toEqual({ raw: rawPayload, endedBeforeDownstream: false })
      }
    }
    finally {
      await close(server)
    }
  })

  it('keeps native Fastify JSON parsing intact after standard plugin registration', async () => {
    const app = Fastify()
    try {
      await app.register(createFastifyPlugin(createOptions()))
      app.post('/native', async req => ({ body: req.body }))
      app.post('/method-only', async req => ({ body: req.body }))
      const origin = await app.listen({ host: '127.0.0.1', port: 0 })
      for (const path of unmatchedPaths) {
        const response = await postJson(new URL(path, origin))
        expect(response.status).toBe(200)
        expect(JSON.parse(response.body)).toEqual({ body: payload })
      }
    }
    finally {
      app.server.closeAllConnections()
      await app.close()
    }
  })

  it('parses Fastify mock POST bodies without requiring a native Fastify route', async () => {
    const app = Fastify()
    try {
      await app.register(createFastifyPlugin(createOptions()))
      const origin = await app.listen({ host: '127.0.0.1', port: 0 })
      for (const [path, id] of [['/mock', null], ['/dynamic/42', '42']] as const) {
        const response = await postJson(new URL(path, origin))
        expect(response.status).toBe(200)
        expect(JSON.parse(response.body)).toEqual({ body: payload, id })
      }
    }
    finally {
      app.server.closeAllConnections()
      await app.close()
    }
  })

  it.each(unmatchedPaths)('leaves unmatched Fetch %s bodies unused and readable', async (path) => {
    const handler = createFetchHandler(createOptions())
    const req = createFetchRequest(path)

    expect(await handler(req)).toBeNull()
    expect(req.bodyUsed).toBe(false)
    expect(await req.text()).toBe(rawPayload)
  })

  it('still parses matched static and dynamic Fetch request bodies', async () => {
    const handler = createFetchHandler(createOptions())
    for (const [path, id] of [['/mock', null], ['/dynamic/42', '42']] as const) {
      const req = createFetchRequest(path)
      const response = await handler(req)
      expect(response?.status).toBe(200)
      expect(await response?.json()).toEqual({ body: payload, id })
      expect(req.bodyUsed).toBe(true)
    }
  })

  it('leaves Hono fallthrough bodies unused while parsing matched mock requests', async () => {
    const app = new Hono()
    app.use('*', createHonoMiddleware(createOptions()))
    for (const path of unmatchedPaths) {
      app.post(path, async (context) => {
        const usedBeforeDownstream = context.req.raw.bodyUsed
        return context.json({ raw: await context.req.text(), usedBeforeDownstream })
      })
    }
    const matched = await app.fetch(createFetchRequest('/dynamic/42'))
    expect(matched.status).toBe(200)
    expect(await matched.json()).toEqual({ body: payload, id: '42' })
    for (const path of unmatchedPaths) {
      const response = await app.fetch(createFetchRequest(path))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ raw: rawPayload, usedBeforeDownstream: false })
    }
  })
})
