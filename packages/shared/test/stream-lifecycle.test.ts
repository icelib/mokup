import type { BodyReadableStream } from '../src/stream-body'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import { setTimeout as nextTurn } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { readStreamBody, withStreamLifecycle } from '../src/stream-body'

const events = ['data', 'end', 'error', 'close', 'aborted']

function expectNoListeners(stream: EventEmitter) {
  expect(events.map(event => stream.listenerCount(event))).toEqual([0, 0, 0, 0, 0])
}

describe('withStreamLifecycle', () => {
  it('leaves a paused request body intact for the next owner', async () => {
    const stream = new PassThrough()
    try {
      const pending = withStreamLifecycle(stream, async () => {
        await nextTurn(0)
        return 'matched'
      })
      stream.write('payload')
      expect(stream.readableFlowing).toBeNull()
      expect(stream.listenerCount('data')).toBe(0)
      expect(stream.listenerCount('end')).toBe(0)
      await expect(pending).resolves.toBe('matched')

      const body = readStreamBody(stream)
      stream.end()
      expect(new TextDecoder().decode(await body ?? new Uint8Array())).toBe('payload')
      await nextTurn(0)
      expectNoListeners(stream)
    }
    finally {
      stream.destroy()
    }
  })

  it('removes only its own listeners after a successful task', async () => {
    const stream = new EventEmitter()
    const upstream = vi.fn()
    for (const event of events) {
      stream.on(event, upstream)
    }
    const result = { matched: false }
    await expect(withStreamLifecycle(stream, () => result)).resolves.toBe(result)
    for (const event of events) {
      expect(stream.listeners(event)).toEqual([upstream])
    }
  })

  it('preserves stream error identity and observes a later task rejection', async () => {
    const stream = new EventEmitter()
    const upstream = vi.fn()
    stream.on('error', upstream)
    const task = Promise.withResolvers<string>()
    const pending = withStreamLifecycle(stream, () => task.promise)
    const failure = new Error('request interrupted')
    stream.emit('error', failure)
    await expect(pending).rejects.toBe(failure)
    expect(upstream).toHaveBeenCalledExactlyOnceWith(failure)
    expect(stream.listeners('error')).toEqual([upstream])
    task.reject(new Error('late manifest failure'))
    await nextTurn(0)
    expect(['data', 'end', 'close', 'aborted'].map(event => stream.listenerCount(event))).toEqual([0, 0, 0, 0])
  })

  it.each([true, false])('handles destroy(error) queued before preflight, emitClose=%s', async (emitClose) => {
    const stream = new PassThrough({ emitClose })
    const failure = new Error('destroyed before matching')
    const task = vi.fn(() => false)
    try {
      stream.destroy(failure)
      await expect(withStreamLifecycle(stream, task)).rejects.toBe(failure)
      expect(task).not.toHaveBeenCalled()
      await nextTurn(0)
      expectNoListeners(stream)
    }
    finally {
      stream.destroy()
    }
  })

  it('checks queued destruction again when a task resolves', async () => {
    const stream = new PassThrough()
    const failure = new Error('destroyed while matching')
    try {
      const pending = withStreamLifecycle(stream, () => Promise.resolve(false))
      stream.destroy(failure)
      await expect(pending).rejects.toBe(failure)
      await nextTurn(0)
      expectNoListeners(stream)
    }
    finally {
      stream.destroy()
    }
  })

  it('guards errors during the microtask handoff to the next owner', async () => {
    const stream = new PassThrough()
    const failure = new Error('destroyed during handoff')
    try {
      const pending = withStreamLifecycle(stream, () => false)
      queueMicrotask(() => stream.destroy(failure))
      await expect(pending).resolves.toBe(false)
      await nextTurn(0)
      expectNoListeners(stream)
    }
    finally {
      stream.destroy()
    }
  })

  it.each(['destroyed', 'closed', 'aborted', 'readableAborted'] as const)('rejects an already %s stream without starting work', async (state) => {
    const stream = Object.assign(new EventEmitter(), { [state]: true })
    const task = vi.fn(() => false)
    await expect(withStreamLifecycle(stream, task)).rejects.toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' })
    expect(task).not.toHaveBeenCalled()
    await nextTurn(0)
    expectNoListeners(stream)
  })

  it.each(['close', 'aborted'])('settles a pending task when the stream emits %s', async (event) => {
    const stream = new EventEmitter()
    const task = Promise.withResolvers<boolean>()
    const pending = withStreamLifecycle(stream, () => task.promise)
    stream.emit(event)
    if (event === 'aborted') {
      stream.emit('error', new Error('connection reset'))
      stream.emit('close')
    }
    await expect(pending).rejects.toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' })
    task.resolve(false)
    await nextTurn(0)
    expectNoListeners(stream)
  })

  it('allows normal EOF and close while the task is still pending', async () => {
    const stream = new PassThrough()
    const task = Promise.withResolvers<boolean>()
    try {
      const closed = once(stream, 'close')
      const pending = withStreamLifecycle(stream, () => task.promise)
      stream.resume()
      stream.end()
      await closed
      task.resolve(true)
      await expect(pending).resolves.toBe(true)
      expectNoListeners(stream)
      await expect(withStreamLifecycle(stream, () => false)).resolves.toBe(false)
      expectNoListeners(stream)
    }
    finally {
      stream.destroy()
    }
  })

  it.each(['throw', 'reject'] as const)('propagates a task %s unchanged and cleans up', async (failureMode) => {
    const stream = new EventEmitter()
    const failure = new Error('manifest unavailable')
    await expect(withStreamLifecycle(stream, () => {
      if (failureMode === 'throw') {
        throw failure
      }
      return Promise.reject(failure)
    })).rejects.toBe(failure)
    expectNoListeners(stream)
  })

  it('cleans up through removeListener when off is unavailable', async () => {
    const emitter = new EventEmitter()
    const stream = { on: emitter.on.bind(emitter), removeListener: emitter.removeListener.bind(emitter) }
    await expect(withStreamLifecycle(stream, () => true)).resolves.toBe(true)
    expectNoListeners(emitter)
  })

  it('makes on-only callbacks inert after the task settles', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const stream: BodyReadableStream = {
      on(event, listener) {
        listeners.set(event, listener)
      },
    }
    await expect(withStreamLifecycle(stream, () => true)).resolves.toBe(true)
    Object.defineProperty(stream, 'off', {
      get() {
        throw new Error('Settled listener must not access the stream')
      },
    })
    expect([...listeners.keys()]).toEqual(['error', 'close', 'aborted'])
    expect(() => listeners.get('error')?.(new Error('late'))).not.toThrow()
    expect(() => listeners.get('close')?.()).not.toThrow()
    expect(() => listeners.get('aborted')?.()).not.toThrow()
  })

  it('handles an error raised synchronously while registering a listener', async () => {
    const failure = new Error('already interrupted')
    const stream: BodyReadableStream = {
      on(event, listener) {
        if (event === 'error') {
          listener(failure)
        }
      },
    }
    const task = vi.fn(() => true)
    await expect(withStreamLifecycle(stream, task)).rejects.toBe(failure)
    expect(task).not.toHaveBeenCalled()
  })
})
