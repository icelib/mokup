import type { Server } from 'node:http'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createConnectMiddleware } from '../src/connect'
import { createExpressMiddleware } from '../src/express'

async function listen(server: Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address')
  }
  return address.port
}

function read(port: number, path: string) {
  return new Promise<{ status: number | undefined, body: string }>((resolve, reject) => {
    const client = request({ hostname: '127.0.0.1', port, path, agent: false }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.once('error', reject)
      res.once('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    client.once('error', reject)
    client.setTimeout(3000, () => client.destroy(new Error('Request-target test timed out')))
    client.end()
  })
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
}

describe.each([
  ['Connect', createConnectMiddleware],
  ['Express', createExpressMiddleware],
] as const)('%s native HTTP request-target boundary', (_name, createMiddleware) => {
  it('rejects non-HTTP absolute targets and serves later valid requests', async () => {
    const loadManifest = vi.fn(async () => ({
      version: 1 as const,
      routes: [{ method: 'GET' as const, url: '/users', response: { type: 'text' as const, body: 'healthy' } }],
    }))
    const middleware = createMiddleware({ manifest: loadManifest })
    const targets: string[] = []
    const next = vi.fn()
    const server = createServer((req, res) => {
      targets.push(req.url ?? '')
      void middleware(req, res, (error) => {
        next(error)
        res.statusCode = error ? Number((error as { statusCode?: number }).statusCode ?? 500) : 404
        res.end(error instanceof Error ? error.message : 'next')
      })
    })

    try {
      const port = await listen(server)
      for (const target of ['ftp://example.com/users', 'ws://example.com/users', 'wss://example.com/users', 'file:///users']) {
        expect(await read(port, target)).toEqual({ status: 400, body: 'Invalid request URL' })
        expect(targets.at(-1)).toBe(target)
        expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ status: 400, statusCode: 400 }))
        expect(loadManifest).not.toHaveBeenCalled()
      }
      for (const target of ['/users', 'http://example.com/users', 'https://example.com/users', 'HTTP://example.com/users']) {
        expect(await read(port, target)).toEqual({ status: 200, body: 'healthy' })
      }
      expect(await read(port, '//example.com/users')).toEqual({ status: 404, body: 'next' })
      expect(await read(port, '/users')).toEqual({ status: 200, body: 'healthy' })
    }
    finally {
      await close(server)
    }
  })
})
