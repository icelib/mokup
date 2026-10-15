import type { BodyReadableStream } from '../src/stream-body'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import { setTimeout as nextTurn } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { readStreamBody } from '../src/stream-body'

const events = ['data', 'end', 'error', 'close']

function expectNoListeners(stream: EventEmitter) {
  expect(events.map(event => stream.listenerCount(event))).toEqual([0, 0, 0, 0])
}

describe('readStreamBody', () => {
  it('joins body chunks and removes only its own listeners on success', async () => {
    const stream = new EventEmitter()
    const upstreamData = vi.fn()
    const upstreamEnd = vi.fn()
    stream.on('data', upstreamData)
    stream.on('end', upstreamEnd)
    const body = readStreamBody(stream)
    stream.emit('data', 'a')
    stream.emit('data', new Uint8Array([98]))
    stream.emit('data', new Uint8Array([99]).buffer)
    stream.emit('data', 123)
    stream.emit('end')

    await expect(body).resolves.toEqual(new TextEncoder().encode('abc123'))
    expect(stream.listeners('data')).toEqual([upstreamData])
    expect(stream.listeners('end')).toEqual([upstreamEnd])
    expect(stream.listenerCount('error')).toBe(0)
    expect(stream.listenerCount('close')).toBe(0)
  })

  it('returns null for an empty body', async () => {
    const stream = new EventEmitter()
    const body = readStreamBody(stream)
    stream.emit('end')
    await expect(body).resolves.toBeNull()
    expectNoListeners(stream)
  })

  it('does not wait for another end after a real stream has reached EOF', async () => {
    const stream = new PassThrough()
    try {
      const ended = once(stream, 'end')
      stream.resume()
      stream.end('consumed upstream')
      await ended
      expect(stream.readableEnded).toBe(true)

      await expect(readStreamBody(stream)).resolves.toBeNull()
      expectNoListeners(stream)
    }
    finally {
      stream.destroy()
    }
  })

  it('rejects with the original error and preserves upstream error listeners', async () => {
    const stream = new EventEmitter()
    const upstreamError = vi.fn()
    stream.on('error', upstreamError)
    const body = readStreamBody(stream)
    const failure = new Error('read failed')
    stream.emit('data', 'partial')
    stream.emit('error', failure)

    await expect(body).rejects.toBe(failure)
    expect(upstreamError).toHaveBeenCalledExactlyOnceWith(failure)
    expect(stream.listeners('error')).toEqual([upstreamError])
    expect(['data', 'end', 'close'].map(event => stream.listenerCount(event))).toEqual([0, 0, 0])
  })

  it('rejects if the stream closes before EOF without an error', async () => {
    const stream = new PassThrough()
    try {
      const body = readStreamBody(stream)
      stream.write('partial')
      stream.destroy()

      await expect(body).rejects.toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' })
      expectNoListeners(stream)
    }
    finally {
      stream.destroy()
    }
  })

  it.each(['destroyed', 'aborted', 'readableAborted'] as const)('rejects an already %s stream', async (state) => {
    const stream = Object.assign(new EventEmitter(), { [state]: true })
    await expect(readStreamBody(stream)).rejects.toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' })
    await nextTurn(0)
    expectNoListeners(stream)
  })

  it('keeps the queued error from destroy(error) handled, then removes its guard', async () => {
    const stream = new PassThrough()
    const failure = new Error('destroyed before reading')
    try {
      stream.destroy(failure)
      await expect(readStreamBody(stream)).rejects.toBe(failure)
      await nextTurn(0)
      expectNoListeners(stream)
    }
    finally {
      stream.destroy()
    }
  })

  it('does not swallow the queued error from upstream listeners', async () => {
    const stream = new PassThrough()
    const upstreamError = vi.fn()
    stream.on('error', upstreamError)
    const failure = new Error('destroyed before reading')
    try {
      stream.destroy(failure)
      await expect(readStreamBody(stream)).rejects.toBe(failure)
      await nextTurn(0)
      expect(upstreamError).toHaveBeenCalledExactlyOnceWith(failure)
      expect(stream.listeners('error')).toEqual([upstreamError])
      expect(['data', 'end', 'close'].map(event => stream.listenerCount(event))).toEqual([0, 0, 0])
    }
    finally {
      stream.destroy()
    }
  })

  it('rejects with an existing error after close has already fired', async () => {
    const stream = new PassThrough()
    const failure = new Error('already closed')
    const upstreamError = vi.fn()
    stream.on('error', upstreamError)
    try {
      const closed = new Promise<void>(resolve => stream.once('close', resolve))
      stream.destroy(failure)
      await closed

      await expect(readStreamBody(stream)).rejects.toBe(failure)
      await nextTurn(0)
      expect(stream.listeners('error')).toEqual([upstreamError])
      expect(['data', 'end', 'close'].map(event => stream.listenerCount(event))).toEqual([0, 0, 0])
    }
    finally {
      stream.destroy()
    }
  })

  it('prefers an existing error over EOF', async () => {
    const failure = new Error('failed at EOF')
    const stream = Object.assign(new EventEmitter(), { readableEnded: true, errored: failure })
    await expect(readStreamBody(stream)).rejects.toBe(failure)
    await nextTurn(0)
    expectNoListeners(stream)
  })

  it('allows an abort followed by the standard error and close events', async () => {
    const stream = new EventEmitter()
    const body = readStreamBody(stream)
    const failure = new Error('connection reset')
    stream.emit('aborted')
    stream.emit('error', failure)
    stream.emit('close')

    await expect(body).rejects.toBe(failure)
    expectNoListeners(stream)
  })

  it('cleans up through removeListener when off is unavailable', async () => {
    const emitter = new EventEmitter()
    const stream = { on: emitter.on.bind(emitter), removeListener: emitter.removeListener.bind(emitter) }
    const body = readStreamBody(stream)
    emitter.emit('end')

    await expect(body).resolves.toBeNull()
    expectNoListeners(emitter)
  })

  it('retains on-only streams with synchronous callbacks and ignores data after settling', async () => {
    let onData: ((...args: unknown[]) => void) | undefined
    const stream: BodyReadableStream = {
      on(event, callback) {
        if (event === 'data') {
          onData = callback
          callback('body')
        }
        else if (event === 'end') {
          callback()
        }
      },
    }
    await expect(readStreamBody(stream)).resolves.toEqual(new TextEncoder().encode('body'))
    const toString = vi.fn(() => 'late')
    onData?.({ toString })
    expect(toString).not.toHaveBeenCalled()
  })

  it('makes terminal on-only guards inert when listeners cannot be removed', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const stream: BodyReadableStream = {
      destroyed: true,
      on(event, listener) {
        listeners.set(event, listener)
      },
    }
    await expect(readStreamBody(stream)).rejects.toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' })
    await nextTurn(0)
    Object.defineProperty(stream, 'off', {
      get() {
        throw new Error('Guard should no longer access the stream')
      },
    })

    expect(() => listeners.get('error')?.(new Error('late'))).not.toThrow()
    expect(() => listeners.get('close')?.()).not.toThrow()
  })

  it('rejects malformed chunks without throwing outside the body promise', async () => {
    const stream = new EventEmitter()
    const body = readStreamBody(stream)
    const failure = new Error('decode failed')
    expect(() => stream.emit('data', {
      toString() {
        throw failure
      },
    })).not.toThrow()

    await expect(body).rejects.toBe(failure)
    expectNoListeners(stream)
  })

  it('handles destruction during synchronous listener registration', async () => {
    const failure = new Error('destroyed while starting')
    const stream = new PassThrough()
    const originalOn = stream.on.bind(stream)
    stream.on = ((event: string, callback: (...args: unknown[]) => void) => {
      const result = originalOn(event, callback)
      if (event === 'data') {
        stream.destroy(failure)
      }
      return result
    }) as typeof stream.on
    try {
      await expect(readStreamBody(stream)).rejects.toBe(failure)
      await nextTurn(0)
      expectNoListeners(stream)
    }
    finally {
      stream.destroy()
    }
  })
})
