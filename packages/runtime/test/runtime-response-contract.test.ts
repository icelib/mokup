import { describe, expect, it } from 'vitest'
import { applyRouteOverrides, toRuntimeResult } from '../src/runtime/response'

const cookies = [
  'session=first; Path=/; Expires=Wed, 21 Oct 2037 07:28:00 GMT; HttpOnly',
  'theme=dark; Path=/; SameSite=Lax',
]

describe('runtime response cookie fields', () => {
  it('preserves separate cookie values while retaining the last scalar value', async () => {
    const headers = new Headers()
    headers.append('Set-Cookie', cookies[0]!)
    headers.append('sEt-CoOkIe', cookies[1]!)
    const result = await toRuntimeResult(new Response('body', { headers }))

    expect(result.headers['set-cookie']).toBe(cookies[1])
    expect(result).toHaveProperty('setCookies', cookies)
    expect(result.body).toBe('body')
  })

  it.each([
    { values: [] },
    { values: ['only=one'] },
    { values: [''] },
  ])('keeps the legacy result shape for $values', async ({ values }) => {
    const headers = new Headers(values.map(value => ['set-cookie', value] as [string, string]))
    const result = await toRuntimeResult(new Response('body', { headers }))

    expect(result).not.toHaveProperty('setCookies')
    expect(result.headers['set-cookie']).toBe(values.at(-1))
  })

  it.each([200, 204, 205, 304])('preserves multiple cookies on bodyless status %s', async (status) => {
    const headers = new Headers(cookies.map(value => ['set-cookie', value] as [string, string]))
    const result = await toRuntimeResult(new Response(null, { status, headers }))

    expect(result).toMatchObject({ status, body: null, setCookies: cookies })
    expect(result.headers['set-cookie']).toBe(cookies[1])
  })

  it.each([204, 205, 304])('retains cookies when a route overrides a body response to %s', async (status) => {
    const headers = new Headers(cookies.map(value => ['set-cookie', value] as [string, string]))
    headers.set('content-length', '4')
    const overridden = applyRouteOverrides(new Response('body', { headers }), {
      method: 'GET',
      url: '/cookies',
      response: { type: 'text', body: 'body' },
      status,
    })
    const result = await toRuntimeResult(overridden)

    expect(result).toMatchObject({ status, body: null, setCookies: cookies })
    expect(result.headers['content-length']).toBe(status === 304 ? '4' : undefined)
  })

  it('cancels discarded HEAD bodies while preserving cookies and representation length', async () => {
    let cancelled = false
    const headers = new Headers(cookies.map(value => ['set-cookie', value] as [string, string]))
    headers.set('content-length', '4')
    const source = new Response(new ReadableStream({
      cancel() {
        cancelled = true
      },
    }), { status: 201, headers })
    const overridden = applyRouteOverrides(source, {
      method: 'HEAD',
      url: '/cookies',
      response: { type: 'text', body: 'body' },
    }, 'HEAD')
    const result = await toRuntimeResult(overridden)

    expect(cancelled).toBe(true)
    expect(result).toMatchObject({ status: 201, body: null, setCookies: cookies })
    expect(result.headers['content-length']).toBe('4')
  })

  it('keeps an older Headers scalar unchanged instead of splitting Expires commas', async () => {
    const combined = cookies.join(', ')
    const response = new Response('body', { headers: { 'set-cookie': combined } })
    Object.defineProperty(response.headers, 'getSetCookie', { value: undefined })
    const result = await toRuntimeResult(response)

    expect(result.headers['set-cookie']).toBe(combined)
    expect(result).not.toHaveProperty('setCookies')
  })

  it('stores prototype-like header names as own scalar data properties', async () => {
    const prototypeKey = '__proto__'
    const headers = new Headers([
      ['__proto__', 'prototype-value'],
      ['constructor', 'constructor-value'],
      ['toString', 'string-value'],
    ])
    const result = await toRuntimeResult(new Response(null, { headers }))

    expect(Object.getPrototypeOf(result.headers)).toBe(Object.prototype)
    expect(Object.hasOwn(result.headers, '__proto__')).toBe(true)
    expect(result.headers[prototypeKey]).toBe('prototype-value')
    expect(result.headers['constructor']).toBe('constructor-value')
    expect(result.headers['tostring']).toBe('string-value')
  })
})

describe('runtime response media types', () => {
  const binary = new Uint8Array([0, 97, 115, 109, 255, 254, 128, 192, 0])

  it.each([
    'application/wasm',
    'font/woff2',
    'application/vnd.example.payload',
    'application/protobuf',
    'application/octet-stream; filename="data.json"',
    'image/png; filename="source.xml"',
    'multipart/form-data; boundary=example',
    'application/not-json-binary',
  ])('retains every byte for %s', async (contentType) => {
    const result = await toRuntimeResult(new Response(binary, {
      headers: { 'content-type': contentType },
    }))

    expect(result.body).toBeInstanceOf(Uint8Array)
    expect(result.body).toEqual(binary)
  })

  it.each([
    'text/plain',
    'text/event-stream; charset=utf-8',
    'application/json',
    'application/ld+json; charset=utf-8',
    'application/problem+json',
    'application/json-seq',
    'application/x-ndjson',
    'application/ndjson',
    'application/xml',
    'application/xhtml+xml',
    'application/xml-dtd',
    'image/svg+xml',
    'application/javascript',
    'application/x-javascript',
    'application/ecmascript',
    'application/x-ecmascript',
    'application/x-www-form-urlencoded',
    'APPLICATION/JSON; charset=UTF-8',
  ])('keeps %s as text', async (contentType) => {
    const result = await toRuntimeResult(new Response('héllo=世界', {
      headers: { 'content-type': contentType },
    }))

    expect(result.body).toBe('héllo=世界')
  })

  it('retains text compatibility when Content-Type is absent or empty', async () => {
    const absent = new Response(new TextEncoder().encode('legacy text'))
    expect(absent.headers.has('content-type')).toBe(false)
    expect((await toRuntimeResult(absent)).body).toBe('legacy text')

    const empty = new Response('legacy text', { headers: { 'content-type': '' } })
    expect((await toRuntimeResult(empty)).body).toBe('legacy text')
  })
})
