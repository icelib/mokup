import type { RuntimeRequest } from '../src/types'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { toFetchRequest } from '../src/runtime/request'

function request(input: Partial<RuntimeRequest> = {}) {
  return toFetchRequest({
    method: 'POST',
    path: '/binary',
    query: {},
    headers: { 'content-type': 'application/octet-stream' },
    body: undefined,
    ...input,
  })
}

describe('runtime request body bytes', () => {
  it('prefers original bytes over raw text and a parsed body', async () => {
    const result = request({
      rawBodyBytes: new Uint8Array([0, 255, 128, 65]),
      rawBody: 'decoded text',
      body: { parsed: true },
    })
    expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual([0, 255, 128, 65])
  })

  it('preserves an explicitly empty byte body instead of falling back', async () => {
    const result = request({ rawBodyBytes: new Uint8Array(), rawBody: 'text', body: { parsed: true } })
    expect(result.body).not.toBeNull()
    expect((await result.arrayBuffer()).byteLength).toBe(0)
  })

  it.each([
    ['Uint8Array slice', () => new Uint8Array([1, 0, 255, 128, 65, 2]).subarray(1, 5)],
    ['Buffer slice', () => Buffer.from([1, 0, 255, 128, 65, 2]).subarray(1, 5)],
    ['SharedArrayBuffer view', () => {
      const bytes = new Uint8Array(new SharedArrayBuffer(6))
      bytes.set([1, 0, 255, 128, 65, 2])
      return bytes.subarray(1, 5)
    }],
  ] as const)('copies only the visible bytes from a %s', async (_name, createBytes) => {
    const bytes = createBytes()
    const result = request({ rawBodyBytes: bytes })
    bytes.fill(9)
    expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual([0, 255, 128, 65])
  })

  it.each(['GET', 'HEAD'])('keeps %s requests bodyless', async (method) => {
    const result = request({ method, rawBodyBytes: new Uint8Array([255]), rawBody: 'text', body: 'parsed' })
    expect(result.body).toBeNull()
    expect((await result.arrayBuffer()).byteLength).toBe(0)
  })

  it.each(['original text', ''])('preserves the legacy raw text value %j', async (rawBody) => {
    const result = request({ rawBody, body: { parsed: true } })
    await expect(result.text()).resolves.toBe(rawBody)
  })

  it('keeps parsed object fallback when neither raw field is available', async () => {
    const result = request({ body: { parsed: true } })
    await expect(result.json()).resolves.toEqual({ parsed: true })
  })
})
