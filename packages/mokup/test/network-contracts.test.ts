import type { IncomingHttpHeaders } from 'node:http'
import { Buffer } from 'node:buffer'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { http, HttpResponse, networkError } from '@mokup/runtime/http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupServer } from '../src/node'

function nativeRequest(url: string, method = 'GET') {
  const request = url.startsWith('https:') ? httpsRequest : httpRequest
  return new Promise<{ status: number | undefined, headers: IncomingHttpHeaders, body: string }>((resolve, reject) => {
    const req = request(url, { method }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('error', reject)
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString(),
      }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('network response contracts', () => {
  const servers: ReturnType<typeof setupServer>[] = []
  const setup = (...handlers: Parameters<typeof setupServer>) => {
    const server = setupServer(...handlers)
    servers.push(server)
    server.listen({ onUnhandled: 'error' })
    return server
  }
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.close()))
    vi.unstubAllGlobals()
  })

  it('rejects network errors across fetch, HTTP, and HTTPS after a server adapter replaces Response', async () => {
    const NativeResponse = globalThis.Response
    vi.stubGlobal('Response', class AdapterResponse extends NativeResponse {})
    setup(http.get('*/error', () => networkError()))
    await expect(fetch('http://mokup.invalid/error')).rejects.toThrow('Failed to fetch')
    await expect(nativeRequest('http://mokup.invalid/error')).rejects.toThrow('Failed to fetch')
    await expect(nativeRequest('https://mokup.invalid/error')).rejects.toThrow('Failed to fetch')
  })

  it.each(['http:', 'https:'])('intercepts named native %s imports without opening a real connection', async (protocol) => {
    const url = `${protocol}//mokup.invalid/native`
    setup(http.get(url, () => HttpResponse.json({ protocol }, { status: 202 })))
    const response = await nativeRequest(url)
    expect(response.status).toBe(202)
    expect(JSON.parse(response.body)).toEqual({ protocol })
  })

  it.each([204, 205, 304])('preserves bodyless %i and separate Set-Cookie headers across clients', async (status) => {
    const url = `https://mokup.invalid/status/${status}`
    const cookies = ['first=one; Path=/; Expires=Mon, 21 Oct 2030 07:28:00 GMT', 'second=two; Path=/']
    const headers = new Headers()
    for (const cookie of cookies) {
      headers.append('set-cookie', cookie)
    }
    headers.append('x-values', 'one')
    headers.append('x-values', 'two')
    setup(http.all(url, () => new Response(null, { status, headers })))
    for (const method of ['GET', 'HEAD']) {
      const fetched = await fetch(url, { method })
      expect(fetched.status).toBe(status)
      expect(fetched.body).toBeNull()
      expect(fetched.headers.getSetCookie()).toEqual(cookies)
      expect(fetched.headers.get('x-values')).toBe('one, two')
      const native = await nativeRequest(url, method)
      expect(native.status).toBe(status)
      expect(native.body).toBe('')
      expect(native.headers['set-cookie']).toEqual(cookies)
      expect(native.headers['x-values']).toBe('one, two')
    }
  })

  it('omits the body of HEAD responses across fetch and native HTTPS', async () => {
    const url = 'https://mokup.invalid/head'
    const headers: [string, string][] = [['set-cookie', 'one=1'], ['set-cookie', 'two=2']]
    setup(http.head(url, () => HttpResponse.text('hidden', { headers })))
    const fetched = await fetch(url, { method: 'HEAD' })
    expect(fetched.body).toBeNull()
    expect(await fetched.text()).toBe('')
    expect(fetched.headers.getSetCookie()).toEqual(['one=1', 'two=2'])
    const native = await nativeRequest(url, 'HEAD')
    expect(native.body).toBe('')
    expect(native.headers['set-cookie']).toEqual(['one=1', 'two=2'])
  })

  it('streams the first chunk before completion and closes unread bodies on disposal', async () => {
    const cleanup = vi.fn()
    const server = setup(http.get('http://mokup.invalid/stream', ({ finalize }) => {
      finalize(cleanup)
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('first')) },
      }))
    }))
    const read = (await fetch('http://mokup.invalid/stream')).body!.getReader()
    expect(new TextDecoder().decode((await read.read()).value)).toBe('first')
    await read.cancel()
    expect(cleanup).toHaveBeenCalledOnce()
    const unread = await fetch('http://mokup.invalid/stream')
    await server.close()
    await expect(unread.text()).rejects.toThrow('disposed')
    expect(cleanup).toHaveBeenCalledTimes(2)
  })
})
