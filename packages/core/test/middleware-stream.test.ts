import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { parseRouteTemplate } from '@mokup/runtime'
import { describe, expect, it, vi } from 'vitest'
import { createHonoApp, createMiddleware } from '../src/middleware'

async function fixture(body: ReadableStream<Uint8Array>) {
  const parsed = parseRouteTemplate('/stream')
  const app = createHonoApp([{ method: 'GET', file: '/stream.get.ts', ...parsed, handler: () => new Response(body) }])
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const middleware = createMiddleware(() => app, logger)
  const server = createServer((req, res) => {
    void middleware(req, res, () => {
      res.statusCode = 404
      res.end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/stream`,
    app,
    logger,
    async close() {
      await app.mockSession.dispose()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}

describe('Connect middleware streaming', () => {
  it('delivers a first chunk while the source is still open and emits shared lifecycle events', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value
        value.enqueue(new TextEncoder().encode('first'))
      },
    })
    const server = await fixture(body)
    const started = vi.fn()
    const mocked = vi.fn()
    server.app.mockSession.events.on('request:start', started)
    server.app.mockSession.events.on('response:mocked', mocked)
    try {
      const response = await fetch(server.url, { signal: AbortSignal.timeout(2000) })
      const reader = response.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
      controller.enqueue(new TextEncoder().encode('second'))
      controller.close()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('second')
      expect((await reader.read()).done).toBe(true)
      expect(started).toHaveBeenCalledOnce()
      expect(mocked.mock.calls[0]?.[0].requestId).toBe(started.mock.calls[0]?.[0].requestId)
      expect(server.logger.error).not.toHaveBeenCalled()
    }
    finally {
      await server.close()
    }
  })

  it('cancels the source and releases session resources when the client disconnects', async () => {
    const cancelled = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('live'))
      },
      cancel: cancelled,
    })
    const server = await fixture(body)
    const controller = new AbortController()
    try {
      const response = await fetch(server.url, { signal: controller.signal })
      const reader = response.body!.getReader()
      expect((await reader.read()).done).toBe(false)
      controller.abort()
      await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
      await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce())
    }
    finally {
      controller.abort()
      await server.close()
    }
  })
})
