import { describe, expect, it, vi } from 'vitest'
import { createMockSession, delay, http, HttpResponse } from '../src/http'

const request = () => new Request('https://example.test/sequence')

describe('session-owned response sequences', () => {
  it('allows the first ordinary asynchronous resolver invocations to overlap', async () => {
    const gate = Promise.withResolvers<void>()
    let entered = 0
    const finalized = vi.fn()
    const session = createMockSession(http.get('/sequence', async ({ request, finalize }) => {
      finalize(finalized)
      if (++entered === 2) {
        gate.resolve()
      }
      await gate.promise
      return HttpResponse.text(new URL(request.url).searchParams.get('id'))
    }))
    try {
      const responses = await Promise.all(['one', 'two'].map(id => session.handle(new Request(`https://example.test/sequence?id=${id}`))))
      expect(await Promise.all(responses.map(response => response?.text()))).toEqual(['one', 'two'])
      expect(finalized).toHaveBeenCalledTimes(2)
    }
    finally {
      gate.resolve()
      await session.dispose()
    }
  })

  it('retains iterator resources until earlier yielded streams also settle', async () => {
    const finalized = vi.fn()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const session = createMockSession(http.get('/sequence', function* ({ finalize }) {
      finalize(finalized)
      yield new Response(new ReadableStream<Uint8Array>({ start(value) {
        controller = value
      } }))
      return HttpResponse.text('last')
    }))
    try {
      const first = await session.handle(request())
      expect(await (await session.handle(request()))?.text()).toBe('last')
      expect(finalized).not.toHaveBeenCalled()
      controller.enqueue(new TextEncoder().encode('still live'))
      controller.close()
      expect(await first?.text()).toBe('still live')
      expect(finalized).toHaveBeenCalledOnce()
    }
    finally {
      await session.dispose()
    }
  })

  it.each(['consume', 'cancel'])('keeps the final returned stream alive until %s', async (operation) => {
    const finalized = vi.fn()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const session = createMockSession(http.get('/sequence', function* ({ finalize }) {
      finalize(finalized)
      yield HttpResponse.text('first')
      return new Response(new ReadableStream<Uint8Array>({ start(value) {
        controller = value
      } }))
    }))
    try {
      expect(await (await session.handle(request()))?.text()).toBe('first')
      const response = await session.handle(request())
      expect(finalized).not.toHaveBeenCalled()
      const reader = response!.body!.getReader()
      controller.enqueue(new TextEncoder().encode('final'))
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('final')
      if (operation === 'consume') {
        controller.close()
        expect((await reader.read()).done).toBe(true)
      }
      else {
        await reader.cancel()
      }
      expect(finalized).toHaveBeenCalledOnce()
    }
    finally {
      await session.dispose()
    }
  })

  it('advances a sync generator, emits a return response once, and falls through after exhaustion', async () => {
    const initialized = vi.fn()
    const finished = vi.fn()
    const handler = http.get('/sequence', function* () {
      initialized()
      try {
        yield HttpResponse.text('first')
        yield undefined
        return HttpResponse.text('last')
      }
      finally {
        finished()
      }
    })
    const session = createMockSession(handler, http.get('/sequence', () => HttpResponse.text('fallback')))
    try {
      const values: string[] = []
      for (let index = 0; index < 5; index++) {
        values.push(await (await session.handle(request()))!.text())
      }
      expect(values).toEqual(['first', 'fallback', 'last', 'fallback', 'fallback'])
      expect(initialized).toHaveBeenCalledOnce()
      expect(finished).toHaveBeenCalledOnce()
    }
    finally {
      await session.dispose()
    }
  })

  it('serializes asynchronous iterator steps for concurrent requests', async () => {
    let running = 0
    let maximum = 0
    const session = createMockSession(http.get('/sequence', async function* () {
      for (let index = 0; index < 8; index++) {
        running++
        maximum = Math.max(maximum, running)
        await delay(1)
        running--
        yield HttpResponse.json({ index })
      }
    }))
    try {
      const responses = await Promise.all(Array.from({ length: 8 }, () => session.handle(request())))
      expect(await Promise.all(responses.map(response => response?.json()))).toEqual(Array.from({ length: 8 }, (_, index) => ({ index })))
      expect(maximum).toBe(1)
    }
    finally {
      await session.dispose()
    }
  })

  it('isolates iterator state in sessions and forks, preserves it on restore and restarts it on reset', async () => {
    const released = vi.fn()
    const definition = http.get('/sequence', function* () {
      try {
        yield HttpResponse.text('first')
        yield HttpResponse.text('second')
      }
      finally {
        released()
      }
    })
    const one = createMockSession(definition)
    const two = createMockSession(definition)
    const fork = one.fork()
    try {
      expect(await (await one.handle(request()))?.text()).toBe('first')
      expect(await (await two.handle(request()))?.text()).toBe('first')
      expect(await (await fork.handle(request()))?.text()).toBe('first')
      one.restoreHandlers()
      expect(await (await one.handle(request()))?.text()).toBe('second')
      one.resetHandlers()
      expect(await (await one.handle(request()))?.text()).toBe('first')
    }
    finally {
      await Promise.all([one.dispose(), two.dispose(), fork.dispose()])
    }
    expect(released).toHaveBeenCalledTimes(4)
  })

  it('closes an iterator exactly once after a once response is consumed', async () => {
    const released = vi.fn()
    const session = createMockSession(http.get('/sequence', function* () {
      try {
        yield undefined
        yield HttpResponse.text('once')
        yield HttpResponse.text('unreachable')
      }
      finally {
        released()
      }
    }, { once: true }))
    try {
      expect(await session.handle(request())).toBeUndefined()
      expect(await (await session.handle(request()))?.text()).toBe('once')
      expect(released).toHaveBeenCalledOnce()
      expect(await session.handle(request())).toBeUndefined()
    }
    finally {
      await session.dispose()
    }
    expect(released).toHaveBeenCalledOnce()
  })

  it('aborts a pending async step, awaits return/finally, and runs iterator finalizers', async () => {
    const entered = Promise.withResolvers<void>()
    const released = vi.fn()
    const finalized = vi.fn()
    const session = createMockSession(http.get('/sequence', async function* ({ request, finalize }) {
      finalize(finalized)
      try {
        yield HttpResponse.text('first')
        entered.resolve()
        await delay('infinite', { signal: request.signal })
        yield HttpResponse.text('never')
      }
      finally {
        await delay(1)
        released()
      }
    }))
    expect(await (await session.handle(request()))?.text()).toBe('first')
    expect(finalized).not.toHaveBeenCalled()
    const pending = session.handle(request())
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await entered.promise
    await session.dispose()
    await rejected
    expect(released).toHaveBeenCalledOnce()
    expect(finalized).toHaveBeenCalledOnce()
  })

  it('closes a removed iterator and permits a fresh use of its definition', async () => {
    const released = vi.fn()
    const definition = http.get('/sequence', function* () {
      try {
        yield HttpResponse.text('first')
      }
      finally {
        released()
      }
    })
    const session = createMockSession(definition)
    expect(await (await session.handle(request()))?.text()).toBe('first')
    session.removeHandlers(definition)
    session.use(definition)
    expect(await (await session.handle(request()))?.text()).toBe('first')
    await session.dispose()
    expect(released).toHaveBeenCalledTimes(2)
  })
})
