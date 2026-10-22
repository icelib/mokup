import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { createFetchHandler } from '../src/fetch'

const manifest = {
  version: 1,
  routes: [
    {
      method: 'GET',
      url: '/hello',
      response: {
        type: 'json',
        body: { ok: true },
      },
    },
  ],
} as const

describe('fetch handler', () => {
  it('returns matched responses', async () => {
    const handler = createFetchHandler({ manifest, onNotFound: 'response' })
    const response = await handler(new Request('http://localhost/hello'))

    expect(response).not.toBeNull()
    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toEqual({ ok: true })
  })

  it('handles binary and empty responses', async () => {
    const handler = createFetchHandler({
      manifest: {
        version: 1,
        routes: [
          {
            method: 'GET',
            url: '/binary',
            response: {
              type: 'binary',
              body: Buffer.from('ok').toString('base64'),
              encoding: 'base64',
            },
          },
          {
            method: 'GET',
            url: '/empty',
            response: {
              type: 'json',
              body: undefined,
            },
          },
        ],
      },
      onNotFound: 'response',
    })

    const binaryResponse = await handler(new Request('http://localhost/binary'))
    expect(binaryResponse?.status).toBe(200)
    const binaryBody = await binaryResponse?.arrayBuffer()
    expect(Buffer.from(binaryBody ?? new ArrayBuffer(0)).toString('utf8')).toBe('ok')

    const emptyResponse = await handler(new Request('http://localhost/empty'))
    expect(emptyResponse?.status).toBe(204)
    const emptyBody = await emptyResponse?.text()
    expect(emptyBody).toBe('')
  })

  it('returns 404 responses when configured', async () => {
    const handler = createFetchHandler({ manifest, onNotFound: 'response' })
    const response = await handler(new Request('http://localhost/missing'))

    expect(response).not.toBeNull()
    expect(response?.status).toBe(404)
  })

  it('returns null when onNotFound is next', async () => {
    const handler = createFetchHandler({ manifest, onNotFound: 'next' })
    const response = await handler(new Request('http://localhost/missing'))

    expect(response).toBeNull()
  })

  it('returns streaming responses before completion and propagates cancellation', async () => {
    let cancelled = false
    const handler = createFetchHandler({
      manifest: { version: 1, routes: [{ method: 'GET', url: '/stream', response: { type: 'module', module: 'stream' } }] },
      moduleMap: { stream: { default: { handler: () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('first')) },
        cancel() { cancelled = true },
      })) } } },
    })
    const response = await handler(new Request('http://localhost/stream'))
    const reader = response!.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
    await reader.cancel()
    expect(cancelled).toBe(true)
  })
})
