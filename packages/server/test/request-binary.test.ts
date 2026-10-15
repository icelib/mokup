import type { RuntimeRequest } from '@mokup/runtime'
import { Buffer } from 'node:buffer'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { handleFetchRequest, handleNodeRequest } from '../src/internal/handle-request'
import { toRuntimeRequestFromFetch, toRuntimeRequestFromNode } from '../src/internal/request'

const payload = [0, 255, 128, 65]

describe('request byte preservation', () => {
  it.each([undefined, 'application/octet-stream', 'application/json', 'text/plain'])('keeps Fetch bytes alongside parsed text for %s', async (contentType) => {
    const bytes = new Uint8Array(payload)
    const request = new Request('http://localhost/echo', {
      method: 'POST',
      ...(contentType ? { headers: { 'content-type': contentType } } : {}),
      body: bytes,
    })
    const readBytes = vi.spyOn(request, 'arrayBuffer')
    const readText = vi.spyOn(request, 'text')
    const clone = vi.spyOn(request, 'clone')

    const result = await toRuntimeRequestFromFetch(request)

    expect(result.rawBodyBytes).toEqual(bytes)
    expect(result.rawBody).toBe(new TextDecoder().decode(bytes))
    expect(result.body).toBe(result.rawBody)
    expect(readBytes).toHaveBeenCalledOnce()
    expect(readText).not.toHaveBeenCalled()
    expect(clone).not.toHaveBeenCalled()
  })

  it('retains a UTF-8 BOM while keeping JSON parsing unchanged', async () => {
    const bytes = new Uint8Array([239, 187, 191, ...new TextEncoder().encode('{"ok":true}')])
    const request = new Request('http://localhost/json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bytes,
    })
    const result = await toRuntimeRequestFromFetch(request)

    expect(result.body).toEqual({ ok: true })
    expect(result.rawBody).toBe('{"ok":true}')
    expect(result.rawBodyBytes).toEqual(bytes)
  })

  it('preserves binary chunks read from a Node stream', async () => {
    const bytes = new Uint8Array(payload)
    const request = Object.assign(new PassThrough(), {
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/octet-stream' },
    })
    try {
      const pending = toRuntimeRequestFromNode(request)
      request.write(bytes.subarray(0, 2))
      request.end(bytes.subarray(2))
      const result = await pending

      expect(result.rawBodyBytes).toEqual(new Uint8Array(payload))
      expect(result.rawBody).toBe(new TextDecoder().decode(bytes))
      expect(result.body).toBe(result.rawBody)
      bytes.fill(1)
      expect(result.rawBodyBytes).toEqual(new Uint8Array(payload))
    }
    finally {
      request.destroy()
    }
  })

  it.each(['Uint8Array', 'ArrayBuffer', 'Buffer'] as const)('snapshots only the supplied %s bytes before returning', async (kind) => {
    const bytes = kind === 'Buffer' ? Buffer.from([1, ...payload, 2]) : new Uint8Array([1, ...payload, 2])
    const view = bytes.subarray(1, -1)
    const input = kind === 'ArrayBuffer' ? new Uint8Array(view).buffer : view
    const pending = toRuntimeRequestFromNode({ url: '/echo', on: vi.fn() }, input)
    bytes.fill(1)
    if (input instanceof ArrayBuffer) {
      new Uint8Array(input).fill(2)
    }

    const result = await pending

    expect(Array.from(result.rawBodyBytes ?? [])).toEqual(payload)
    expect(result.rawBodyBytes?.byteLength).toBe(payload.length)
    expect(result.rawBodyBytes?.buffer.byteLength).toBe(payload.length)
    expect(result.rawBody).toBe(new TextDecoder().decode(new Uint8Array(payload)))
  })

  it('retains Node byte overrides while asynchronous runtime work is pending', async () => {
    const bytes = new Uint8Array(payload)
    const engine = {
      hasRoute: async () => true,
      handle: vi.fn(async (request: RuntimeRequest) => {
        bytes.fill(1)
        await Promise.resolve()
        return { status: 200, headers: {}, body: request.rawBodyBytes ?? null }
      }),
    }
    const result = await handleNodeRequest(engine, { method: 'POST', url: '/echo', on: vi.fn() }, bytes)

    expect(result?.body).toEqual(new Uint8Array(payload))
  })

  it.each(['fetch', 'node'] as const)('preserves explicitly empty %s bytes and omits empty raw text', async (adapter) => {
    const bytes = new Uint8Array(0)
    const result = adapter === 'fetch'
      ? await toRuntimeRequestFromFetch(new Request('http://localhost/empty', { method: 'POST', body: bytes }))
      : await toRuntimeRequestFromNode({ url: '/empty', on: vi.fn() }, bytes)

    expect(result.body).toBeUndefined()
    expect(result.rawBody).toBeUndefined()
    expect(result.rawBodyBytes).toEqual(bytes)
  })

  it('keeps absent Fetch bodies absent', async () => {
    const result = await toRuntimeRequestFromFetch(new Request('http://localhost/empty', { method: 'POST' }))
    expect(result.body).toBeUndefined()
    expect(result.rawBody).toBeUndefined()
    expect(result.rawBodyBytes).toBeUndefined()
  })

  it('leaves unmatched Fetch binary streams unread', async () => {
    const request = new Request('http://localhost/native', { method: 'POST', body: new Uint8Array(payload) })
    const readBytes = vi.spyOn(request, 'arrayBuffer')
    const engine = { hasRoute: async () => false, handle: vi.fn() }

    expect(await handleFetchRequest(engine, request)).toBeNull()
    expect(readBytes).not.toHaveBeenCalled()
    expect(request.bodyUsed).toBe(false)
    expect(request.body?.locked).toBe(false)
    expect(Array.from(new Uint8Array(await request.arrayBuffer()))).toEqual(payload)
  })
})
