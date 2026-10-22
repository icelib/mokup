import type { ResolvedHttpRoute } from '../src/resolved-handlers'
import { describe, expect, it, vi } from 'vitest'
import { defineHttpHandler, HttpResponse } from '../src/http'
import { createResolvedRouteApp } from '../src/resolved-handlers'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('file middleware response ownership', () => {
  it.each(['early', 'post'] as const)('releases a late %s middleware response after cancellation', async (phase) => {
    const entered = deferred()
    const release = deferred()
    const cancelled = deferred()
    const cancel = vi.fn(cancelled.resolve)
    const stream = () => new Response(new ReadableStream({ cancel }))
    const routes: ResolvedHttpRoute[] = [{
      method: 'GET',
      tokens: [{ type: 'static', value: 'stream' }],
      ...defineHttpHandler(() => stream()),
      middlewares: [{ position: 'normal', handle: async (_c, next) => {
        if (phase === 'post') {
          await next()
        }
        entered.resolve()
        await release.promise
        return phase === 'early' ? stream() : undefined
      } }],
    }]
    const app = createResolvedRouteApp(routes)
    const controller = new AbortController()
    const result = app.fetch(new Request('https://example.test/stream', { signal: controller.signal }))
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await entered.promise
      controller.abort()
      await rejected
      if (phase === 'post') {
        await cancelled.promise
      }
      release.resolve()
      await cancelled.promise
      expect(cancel).toHaveBeenCalledOnce()
    }
    finally {
      release.resolve()
      await app.mockSession.dispose()
    }
  })

  it.each(['http', 'hono'] as const)('discards the original %s response when middleware replaces its body', async (handlerType) => {
    const cancel = vi.fn()
    const source = () => new Response(new ReadableStream({ cancel }))
    const app = createResolvedRouteApp([{
      method: 'GET',
      tokens: [{ type: 'static', value: 'stream' }],
      handlerType,
      handler: source,
      middlewares: [{ position: 'post', handle: async (c, next) => {
        await next()
        c.res = HttpResponse.text('replaced')
      } }],
    }])
    try {
      expect(await (await app.request('/stream')).text()).toBe('replaced')
      expect(cancel).toHaveBeenCalledOnce()
    }
    finally {
      await app.mockSession.dispose()
    }
  })

  it.each(['http', 'hono'] as const)('delivers a middleware clone of a %s stream and releases both branches on cancellation', async (handlerType) => {
    const cancel = vi.fn()
    const app = createResolvedRouteApp([{
      method: 'GET',
      tokens: [{ type: 'static', value: 'stream' }],
      handlerType,
      handler: () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('first')) },
        cancel,
      })),
      middlewares: [{ position: 'post', handle: async (c, next) => {
        await next()
        c.res = c.res.clone()
      } }],
    }])
    try {
      const reader = (await app.request('/stream')).body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
      await reader.cancel()
      expect(cancel).toHaveBeenCalledOnce()
    }
    finally {
      await app.mockSession.dispose()
    }
  })
})
