import type { IncomingHttpHeaders, Server } from 'node:http'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
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
import { cookieCases, createCookieOptions } from './fixtures/cookie-options'

interface HttpResponse {
  status: number | undefined
  cookies: string[]
  marker: string | string[] | undefined
  headers: IncomingHttpHeaders
  body: string
  bytes: number[]
}

function readHttpResponse(url: URL, method = 'GET'): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = request(url, { agent: false, method }, (res) => {
      const cookies: string[] = []
      for (let index = 0; index < res.rawHeaders.length; index += 2) {
        if (res.rawHeaders[index]?.toLowerCase() === 'set-cookie') {
          cookies.push(res.rawHeaders[index + 1]!)
        }
      }
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.once('error', reject)
      res.once('end', () => {
        const body = Buffer.concat(chunks)
        resolve({
          status: res.statusCode,
          cookies,
          marker: res.headers['x-test'],
          headers: res.headers,
          body: body.toString('utf8'),
          bytes: Array.from(body),
        })
      })
    })
    req.setTimeout(1500, () => req.destroy(new Error('Cookie response timed out')))
    req.once('error', reject)
    req.end()
  })
}

async function expectHttpCookies(origin: string) {
  for (const { name, cookies } of cookieCases) {
    const response = await readHttpResponse(new URL(`/cookies/${name}`, origin))
    expect(response).toMatchObject({ status: 200, cookies, marker: 'cookies', body: name })
  }
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

describe('cookie response fields over HTTP', () => {
  it.each([
    ['Connect', createConnectMiddleware],
    ['Express', createExpressMiddleware],
  ] as const)('preserves cookies with the %s adapter on native Node HTTP', async (_name, createMiddleware) => {
    const middleware = createMiddleware(createCookieOptions())
    const server = createServer((req, res) => {
      void middleware(req, res, (error) => {
        res.statusCode = error ? 500 : 404
        res.end()
      })
    })
    try {
      await expectHttpCookies(await listen(server))
    }
    finally {
      await close(server)
    }
  })

  it('preserves cookies with an actual Koa context', async () => {
    const app = new Koa()
    app.use(createKoaMiddleware({ ...createCookieOptions(), onNotFound: 'response' }))
    const server = createServer(app.callback())
    try {
      const origin = await listen(server)
      await expectHttpCookies(origin)
      expect(await readHttpResponse(new URL('/missing', origin))).toMatchObject({ status: 404, cookies: [], bytes: [] })
    }
    finally {
      await close(server)
    }
  })

  it('preserves cookies with an actual Fastify reply', async () => {
    const app = Fastify()
    try {
      await app.register(createFastifyPlugin(createCookieOptions()))
      await expectHttpCookies(await app.listen({ host: '127.0.0.1', port: 0 }))
    }
    finally {
      await app.close()
    }
  })

  it('preserves Koa HEAD metadata, bodyless status cookies, and binary bytes', async () => {
    const cookies = ['session=first; Path=/', 'preferences=dark; Path=/']
    const responseHeaders = () => {
      const headers = new Headers({
        'content-type': 'application/wasm',
        'content-length': '7',
        'etag': '"v1"',
      })
      cookies.forEach(cookie => headers.append('set-cookie', cookie))
      return headers
    }
    const app = new Koa()
    app.use(createKoaMiddleware({
      manifest: {
        version: 1,
        routes: [
          { method: 'HEAD', url: '/head', response: { type: 'module', module: 'mock:head' } },
          { method: 'GET', url: '/cached', response: { type: 'module', module: 'mock:cached' } },
          { method: 'GET', url: '/binary', response: { type: 'module', module: 'mock:binary' } },
        ],
      },
      moduleMap: {
        'mock:head': { default: { handler: () => new Response('payload', { status: 201, headers: responseHeaders() }) } },
        'mock:cached': { default: { handler: () => new Response(null, { status: 304, headers: responseHeaders() }) } },
        'mock:binary': {
          default: {
            handler: () => new Response(new Uint8Array([0, 255, 128]), { headers: { 'content-type': 'application/wasm' } }),
          },
        },
      },
    }))
    const server = createServer(app.callback())
    try {
      const origin = await listen(server)
      const head = await readHttpResponse(new URL('/head', origin), 'HEAD')
      expect(head).toMatchObject({ status: 201, cookies, bytes: [] })
      expect(head.headers).toMatchObject({ 'content-length': '7', 'content-type': 'application/wasm', 'etag': '"v1"' })

      const cached = await readHttpResponse(new URL('/cached', origin))
      expect(cached).toMatchObject({ status: 304, cookies, bytes: [] })
      expect(cached.headers['etag']).toBe('"v1"')

      const binary = await readHttpResponse(new URL('/binary', origin))
      expect(binary).toMatchObject({ status: 200, bytes: [0, 255, 128] })
      expect(binary.headers['content-type']).toBe('application/wasm')
    }
    finally {
      await close(server)
    }
  })

  it.each(['fetch', 'hono', 'worker'] as const)('preserves cookies in the %s Fetch response', async (adapter) => {
    const options = createCookieOptions()
    const fetchHandler = createFetchHandler(options)
    const honoMiddleware = createHonoMiddleware(options)
    const worker = createMokupWorker(options)
    for (const { name, cookies } of cookieCases) {
      const input = new Request(`http://localhost/cookies/${name}`)
      const response = adapter === 'fetch'
        ? await fetchHandler(input)
        : adapter === 'hono'
          ? await honoMiddleware({ req: { raw: input } }, async () => undefined)
          : await worker.fetch(input)
      expect(response).toBeInstanceOf(Response)
      expect(response?.headers.getSetCookie()).toEqual(cookies)
      expect(response?.headers.get('x-test')).toBe('cookies')
      expect(await response?.text()).toBe(name)
    }
  })
})
