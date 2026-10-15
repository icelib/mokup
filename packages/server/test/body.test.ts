import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { parseBody, resolveBody, toArrayBuffer } from '../src/internal/body'

describe('internal body helpers', () => {
  it('parses JSON and urlencoded bodies', () => {
    expect(parseBody('', 'application/json')).toBeUndefined()
    expect(parseBody('{"ok":true}', 'application/json')).toEqual({ ok: true })
    expect(parseBody('not-json', 'application/json')).toBe('not-json')
    expect(parseBody('a=1&b=2', 'application/x-www-form-urlencoded')).toEqual({ a: '1', b: '2' })
    expect(parseBody('plain', 'text/plain')).toBe('plain')
  })

  it('returns array buffer views correctly', () => {
    const full = new Uint8Array([1, 2, 3])
    expect(toArrayBuffer(full)).toBe(full.buffer)

    const slice = full.subarray(1)
    const buffer = toArrayBuffer(slice)
    expect(buffer).not.toBe(full.buffer)
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([2, 3]))
  })

  it('resolves provided body values', async () => {
    const text = await resolveBody('{"ok":true}', 'application/json')
    expect(text).toEqual({ body: { ok: true }, rawBody: '{"ok":true}' })

    const bytes = new Uint8Array([123, 125])
    const fromBytes = await resolveBody(bytes, 'application/json')
    expect(fromBytes.body).toEqual({})
    expect(fromBytes.rawBody).toBe('{}')
    expect(fromBytes.rawBodyBytes).toEqual(bytes)
    expect(fromBytes.rawBodyBytes).not.toBe(bytes)

    const buffer = new Uint8Array([97, 61, 49]).buffer
    const fromBuffer = await resolveBody(buffer, 'application/x-www-form-urlencoded')
    expect(fromBuffer.body).toEqual({ a: '1' })
    expect(fromBuffer.rawBody).toBe('a=1')
    expect(fromBuffer.rawBodyBytes).toEqual(new Uint8Array(buffer))

    const object = await resolveBody({ ok: true }, 'text/plain')
    expect(object).toEqual({ body: { ok: true } })
  })

  it('reads stream bodies when no body is provided', async () => {
    const stream = new EventEmitter()
    const promise = resolveBody(undefined, 'text/plain', stream as never)
    stream.emit('data', 'hi')
    stream.emit('data', new Uint8Array([32, 111, 107]))
    stream.emit('data', new Uint8Array([65]).buffer)
    stream.emit('data', 123)
    stream.emit('end')

    const result = await promise
    expect(result.rawBody).toContain('hi ok')
    expect(result.rawBodyBytes).toEqual(new TextEncoder().encode(result.rawBody))
  })

  it('returns undefined when stream has no data', async () => {
    const stream = new EventEmitter()
    const promise = resolveBody(undefined, 'text/plain', stream as never)
    stream.emit('end')

    const result = await promise
    expect(result).toEqual({ body: undefined })
  })

  it('retains an explicitly empty byte stream without adding raw text', async () => {
    const stream = new EventEmitter()
    const promise = resolveBody(undefined, 'text/plain', stream)
    stream.emit('data', new Uint8Array(0))
    stream.emit('end')

    await expect(promise).resolves.toEqual({ body: undefined, rawBodyBytes: new Uint8Array(0) })
  })

  it('rejects when stream errors', async () => {
    const stream = new EventEmitter()
    const promise = resolveBody(undefined, 'text/plain', stream as never)
    stream.emit('error', new Error('boom'))
    await expect(promise).rejects.toThrow('boom')
  })
})
