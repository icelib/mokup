import type { RequestHandler } from '@mokup/runtime'
import type { Server } from 'node:http'
import type { WorkerBundle } from '../src/types'
import { once } from 'node:events'
import { createServer } from 'node:http'
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
import { createMokupWorker } from '../src/worker'
import { createMokupWorker as createNodeWorker } from '../src/worker-node'

type PayloadKind = 'binary' | 'multipart'
const bytes = [0, 255, 128, 65]
const label = '上传文件 ☃'

function createOptions(): WorkerBundle {
  const binary: RequestHandler = async context => ({
    bytes: Array.from(new Uint8Array(await context.req.arrayBuffer())),
  })
  const multipart: RequestHandler = async (context) => {
    const form = await context.req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') {
      throw new Error('Expected the uploaded file')
    }
    return {
      bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
      label: form.get('label'),
      filename: file.name,
      contentType: file.type,
    }
  }
  return {
    manifest: {
      version: 1,
      routes: [
        { method: 'POST', url: '/binary', response: { type: 'module', module: 'mock:binary' } },
        { method: 'POST', url: '/multipart', response: { type: 'module', module: 'mock:multipart' } },
      ],
    },
    moduleMap: {
      'mock:binary': { default: { handler: binary } },
      'mock:multipart': { default: { handler: multipart } },
    },
  }
}

function createRequest(kind: PayloadKind, origin = 'http://localhost') {
  const url = new URL(`/${kind}`, origin)
  if (kind === 'binary') {
    return new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
    })
  }
  const form = new FormData()
  form.set('label', label)
  form.set('file', new File([new Uint8Array(bytes)], 'payload.bin', { type: 'application/octet-stream' }))
  return new Request(url, { method: 'POST', body: form })
}

async function expectPayload(response: Response | null, kind: PayloadKind) {
  expect(response?.status).toBe(200)
  expect(await response?.json()).toEqual(kind === 'binary'
    ? { bytes }
    : { bytes, label, filename: 'payload.bin', contentType: 'application/octet-stream' })
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

describe.each(['binary', 'multipart'] as const)('%s request byte preservation', (kind) => {
  it.each([
    ['Connect', createConnectMiddleware],
    ['Express', createExpressMiddleware],
  ] as const)('%s preserves bytes through a real HTTP request', async (_name, createMiddleware) => {
    const middleware = createMiddleware(createOptions())
    const server = createServer((req, res) => {
      void middleware(req, res, (error) => {
        res.statusCode = error ? 500 : 404
        res.end(error ? String(error) : 'Unmatched mock route')
      })
    })
    try {
      const origin = await listen(server)
      await expectPayload(await fetch(createRequest(kind, origin)), kind)
    }
    finally {
      await close(server)
    }
  })

  it('Koa preserves bytes through a real HTTP request', async () => {
    const app = new Koa()
    app.use(createKoaMiddleware(createOptions()))
    const server = createServer(app.callback())
    try {
      const origin = await listen(server)
      await expectPayload(await fetch(createRequest(kind, origin)), kind)
    }
    finally {
      await close(server)
    }
  })

  it('Fastify preserves bytes without a native route or body parser', async () => {
    const app = Fastify()
    try {
      await app.register(createFastifyPlugin(createOptions()))
      const origin = await app.listen({ host: '127.0.0.1', port: 0 })
      await expectPayload(await fetch(createRequest(kind, origin)), kind)
    }
    finally {
      app.server.closeAllConnections()
      await app.close()
    }
  })

  it('Fetch preserves request bytes', async () => {
    const handler = createFetchHandler(createOptions())
    await expectPayload(await handler(createRequest(kind)), kind)
  })

  it('Hono preserves request bytes', async () => {
    const app = new Hono()
    app.use('*', createHonoMiddleware(createOptions()))
    await expectPayload(await app.fetch(createRequest(kind)), kind)
  })

  it.each([
    ['Worker', createMokupWorker],
    ['Node Worker', createNodeWorker],
  ] as const)('%s preserves request bytes', async (_name, createWorker) => {
    const worker = createWorker(createOptions())
    await expectPayload(await worker.fetch(createRequest(kind)), kind)
  })
})
