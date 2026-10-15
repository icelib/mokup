import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { toRewrittenRequestInit } from '../src/adapters/fetch-request'

describe('rewritten Request body lifecycle', () => {
  it('retains an absent body without adding payload bytes', async () => {
    const request = new Request('http://localhost/source')
    expect(await toRewrittenRequestInit(request, {})).toMatchObject({ method: 'GET', body: null })
  })

  it('accepts Uint8Array chunks created in another realm', async () => {
    const bytes = runInNewContext('new Uint8Array([0, 127, 255])') as Uint8Array
    const request = new Request('http://localhost/source', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit)
    const init = await toRewrittenRequestInit(request, {})
    expect(init.body).toBeInstanceOf(Blob)
    expect([...new Uint8Array(await (init.body as Blob).arrayBuffer())]).toEqual([0, 127, 255])
  })

  it('cancels invalid body chunks and releases the reader', async () => {
    const cancel = vi.fn()
    const request = new Request('http://localhost/source', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue('invalid chunk')
        },
        cancel,
      }),
      duplex: 'half',
    } as RequestInit)
    await expect(toRewrittenRequestInit(request, {})).rejects.toBeInstanceOf(TypeError)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(expect.any(TypeError))
    expect(request.body?.locked).toBe(false)
  })

  it('copies each chunk before the source reuses its backing bytes', async () => {
    const bytes = new Uint8Array(1)
    let index = 0
    const request = new Request('http://localhost/source', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index === 3) {
            controller.close()
            return
          }
          bytes[0] = ++index
          controller.enqueue(bytes)
        },
      }, { highWaterMark: 0 }),
      duplex: 'half',
    } as RequestInit)
    const init = await toRewrittenRequestInit(request, {})
    expect(init.body).toBeInstanceOf(Blob)
    expect([...new Uint8Array(await (init.body as Blob).arrayBuffer())]).toEqual([1, 2, 3])
    expect(request.body?.locked).toBe(false)
  })

  it('rejects promptly with the abort reason and cleans up even if cancel never settles', async () => {
    const controller = new AbortController()
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const stream = new ReadableStream<Uint8Array>({ cancel })
    const request = new Request('http://localhost/source', {
      method: 'POST',
      body: stream,
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit)
    const remove = vi.spyOn(request.signal, 'removeEventListener')
    const reason = { interrupted: true }
    const pending = toRewrittenRequestInit(request, {})
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason)
    expect(request.body?.locked).toBe(false)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('handles cancellation rejection and preserves the original abort reason', async () => {
    const controller = new AbortController()
    const cancel = vi.fn(async () => {
      throw new Error('cancel failed')
    })
    const request = new Request('http://localhost/source', {
      method: 'POST',
      body: new ReadableStream({ cancel }),
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit)
    const pending = toRewrittenRequestInit(request, {})
    controller.abort(null)
    await expect(pending).rejects.toBeNull()
    expect(cancel).toHaveBeenCalledExactlyOnceWith(null)
    expect(request.body?.locked).toBe(false)
  })

  it('preserves body read failures and releases the reader', async () => {
    const failure = new Error('source failed')
    const request = new Request('http://localhost/source', {
      method: 'POST',
      body: new ReadableStream({ start(controller) { controller.error(failure) } }),
      duplex: 'half',
    } as RequestInit)
    const remove = vi.spyOn(request.signal, 'removeEventListener')
    await expect(toRewrittenRequestInit(request, {})).rejects.toBe(failure)
    expect(request.body?.locked).toBe(false)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
