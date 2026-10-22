import { describe, expect, it, vi } from 'vitest'
import { createMockSession, http, HttpResponse } from '../src/http'
import { createResponseReplay } from '../src/http/response-replay'

describe('response replay stream ownership', () => {
  it('streams the first response and replays exact bytes after completion', async () => {
    let source!: ReadableStreamDefaultController<Uint8Array>
    const replay = createResponseReplay(new Response(new ReadableStream({ start(controller) {
      source = controller
    } }), { headers: { 'x-test': 'preserved' } }))
    try {
      const first = replay.take()
      const reader = first.body!.getReader()
      source.enqueue(new Uint8Array([0, 255, 128]))
      const chunk = (await reader.read()).value!
      expect(chunk).toEqual(new Uint8Array([0, 255, 128]))
      chunk.fill(1)
      source.enqueue(new Uint8Array([65]))
      source.close()
      expect((await reader.read()).value).toEqual(new Uint8Array([65]))
      expect((await reader.read()).done).toBe(true)
      const second = replay.take()
      expect(second.headers.get('x-test')).toBe('preserved')
      expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array([0, 255, 128, 65]))
    }
    finally { await replay.close() }
  })

  it('supports concurrent readers without duplicating upstream reads', async () => {
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(new Uint8Array([pull.mock.calls.length]))
      if (pull.mock.calls.length === 3) {
        controller.close()
      }
    })
    const replay = createResponseReplay(new Response(new ReadableStream({ pull }, { highWaterMark: 0 })))
    try {
      const copies = await Promise.all([replay.take().arrayBuffer(), replay.take().arrayBuffer()])
      expect(copies.map(body => [...new Uint8Array(body)])).toEqual([[1, 2, 3], [1, 2, 3]])
      expect(pull).toHaveBeenCalledTimes(3)
    }
    finally { await replay.close() }
  })

  it('cancels an incomplete source when its delivered response is cancelled', async () => {
    const cancel = vi.fn()
    const replay = createResponseReplay(new Response(new ReadableStream({ cancel })))
    try {
      await replay.take().body!.cancel('caller stopped')
      expect(cancel).toHaveBeenCalledExactlyOnceWith('caller stopped')
      await expect(replay.take().text()).rejects.toBe('caller stopped')
    }
    finally { await replay.close() }
  })

  it('keeps an earlier stream alive when the iterator supplies a newer replay value', async () => {
    const cancelled = vi.fn()
    let source!: ReadableStreamDefaultController<Uint8Array>
    const definition = Object.freeze({ ...http.get('/item', function* () {
      yield new Response(new ReadableStream({ start(controller) {
        source = controller
      }, cancel: cancelled }))
      yield HttpResponse.text('last')
    }), execution: { sequence: 'repeat-last' as const } })
    const session = createMockSession(definition)
    const request = () => new Request('https://replay.test/item')
    try {
      const first = await session.handle(request())
      expect(await (await session.handle(request()))?.text()).toBe('last')
      source.enqueue(new TextEncoder().encode('still live'))
      source.close()
      expect(await first?.text()).toBe('still live')
      expect(cancelled).not.toHaveBeenCalled()
      expect(await (await session.handle(request()))?.text()).toBe('last')
    }
    finally { await session.dispose() }
  })
})
