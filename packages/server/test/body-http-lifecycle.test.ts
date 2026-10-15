import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NodeRequestLike } from '../src/internal/types'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { setTimeout as nextTurn } from 'node:timers/promises'
import { Hono } from '@mokup/shared/hono'
import { describe, expect, it, vi } from 'vitest'
import { createMiddleware } from '../../core/src/middleware'
import { createConnectMiddleware } from '../src/connect'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('HTTP body read did not settle')), 5000)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

function createAdapter(kind: 'server' | 'core') {
  const next = vi.fn()
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
  const app = new Hono().on(['GET', 'POST'], '/probe', c => c.text('ok'))
  const middleware = kind === 'core'
    ? createMiddleware(() => app, logger)
    : createConnectMiddleware({
        manifest: {
          version: 1,
          routes: [
            { method: 'GET', url: '/probe', response: { type: 'text', body: 'ok' } },
            { method: 'POST', url: '/probe', response: { type: 'text', body: 'ok' } },
          ],
        },
      })
  return {
    next,
    logger,
    run: (req: IncomingMessage, res: ServerResponse) => middleware(req as IncomingMessage & NodeRequestLike, res, next),
  }
}

async function closeServer(server: ReturnType<typeof createServer>) {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
}

describe.each(['server', 'core'] as const)('%s HTTP body lifecycle', (kind) => {
  it('responds when upstream middleware has already consumed the request', async () => {
    const adapter = createAdapter(kind)
    const completed = deferred<IncomingMessage>()
    const server = createServer((req, res) => {
      req.once('end', () => {
        void adapter.run(req, res).then(() => completed.resolve(req), completed.reject)
      })
      req.resume()
    })
    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP server address')
      }
      const response = await fetch(`http://127.0.0.1:${address.port}/probe`, {
        signal: AbortSignal.timeout(5000),
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('ok')
      const req = await within(completed.promise)
      expect(req.readableEnded).toBe(true)
      expect(['data', 'end', 'error', 'close'].map(event => req.listenerCount(event))).toEqual([0, 0, 0, 0])
    }
    finally {
      await closeServer(server)
    }
  }, 10000)

  it.each(['during reading', 'before reading'] as const)('settles when the client aborts %s', async (timing) => {
    const adapter = createAdapter(kind)
    const started = deferred<IncomingMessage>()
    const completed = deferred<void>()
    const closed = deferred<void>()
    const upstreamError = vi.fn()
    const server = createServer((req, res) => {
      req.on('error', upstreamError)
      req.once('close', () => closed.resolve())
      started.resolve(req)
      if (timing === 'before reading') {
        req.resume()
        void closed.promise
          .then(() => adapter.run(req, res))
          .then(() => completed.resolve(), completed.reject)
      }
      else {
        void adapter.run(req, res).then(() => completed.resolve(), completed.reject)
      }
    })
    let client: ReturnType<typeof request> | undefined
    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP server address')
      }
      client = request({
        host: '127.0.0.1',
        port: address.port,
        path: '/probe',
        method: 'POST',
        headers: { 'content-length': 20 },
      })
      client.on('error', () => {})
      client.write('partial')
      const req = await within(started.promise)
      client.destroy()
      await within(completed.promise)
      await within(closed.promise)
      await nextTurn(0)

      expect(req.readableEnded).toBe(false)
      expect(req.aborted).toBe(true)
      expect(upstreamError).toHaveBeenCalledExactlyOnceWith(req.errored)
      expect(req.errored).toMatchObject({ code: 'ECONNRESET' })
      if (kind === 'server') {
        expect(adapter.next).toHaveBeenCalledExactlyOnceWith(req.errored)
      }
      else {
        expect(adapter.logger.error).toHaveBeenCalledExactlyOnceWith('Mock handler failed:', req.errored)
      }
      expect(req.listeners('error')).toEqual([upstreamError])
      expect(['data', 'end', 'close'].map(event => req.listenerCount(event))).toEqual([0, 0, 0])
    }
    finally {
      client?.destroy()
      await closeServer(server)
    }
  }, 15000)
})
