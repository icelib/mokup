import type { IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createRecordingFetch, createReplay } from '../src/recording'

interface ObservedRequest {
  method: string | undefined
  url: string | undefined
  headers: IncomingHttpHeaders
  body: Buffer
}

async function withBackend(run: (origin: string, requests: ObservedRequest[]) => Promise<void>) {
  const requests: ObservedRequest[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk))
    }
    const body = Buffer.concat(chunks)
    requests.push({ method: request.method, url: request.url, headers: request.headers, body })
    response.setHeader('connection', 'close')
    response.setHeader('set-cookie', 'session=RESPONSE_SECRET; HttpOnly')
    if (request.url?.startsWith('/json')) {
      response.writeHead(429, { 'content-type': 'application/json' })
      response.end('{"token":"RESPONSE_SECRET","error":"rate limit"}')
    }
    else if (request.url === '/invalid') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"token":"RESPONSE_SECRET"')
    }
    else if (request.url === '/large') {
      response.end('RESPONSE_SECRET'.repeat(100))
    }
    else {
      response.writeHead(201, { 'content-type': 'application/octet-stream' })
      response.end(body.length ? body : 'ok')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests)
  }
  finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
  }
}

describe('explicit recording fetch forwarding', () => {
  it('forwards the original request and response with exact binary bytes over local HTTP', async () => {
    await withBackend(async (origin, observed) => {
      let received: Response | undefined
      const forward = vi.fn(async (request: Request) => {
        received = await fetch(request)
        return received
      })
      const recorder = createRecordingFetch(forward)
      const bytes = new Uint8Array([0, 255, 128, 65])
      const request = new Request(`${origin}/binary`, { method: 'POST', body: bytes, headers: { authorization: 'Bearer REQUEST_SECRET', cookie: 'session=REQUEST_SECRET' } })
      const response = await recorder.fetch(request)
      expect(forward).toHaveBeenCalledExactlyOnceWith(request)
      expect(response).toBe(received)
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
      await recorder.flush()
      expect(observed[0]?.body).toEqual(Buffer.from(bytes))
      expect(observed[0]?.headers.authorization).toBe('Bearer REQUEST_SECRET')
      const fixtures = recorder.fixtures()
      expect(fixtures).toHaveLength(1)
      expect(JSON.stringify(fixtures)).not.toContain('SECRET')
      expect(recorder.errors()).toEqual([])
      const replayed = await createReplay(fixtures).handle(new Request(`${origin}/binary`, { method: 'POST', body: bytes }))
      expect(new Uint8Array(await replayed!.arrayBuffer())).toEqual(bytes)
      fixtures[0]!.request.url = 'https://mutated.test/'
      expect(recorder.fixtures()[0]!.request.url).toBe(`${origin}/binary`)
    })
  })

  it('preserves real rate-limited responses while redacting only the saved fixture', async () => {
    await withBackend(async (origin, observed) => {
      const recorder = createRecordingFetch(fetch, { redact: { query: ['token'], jsonPointers: ['/token'] } })
      const response = await recorder.fetch(`${origin}/json?token=QUERY_SECRET`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer REQUEST_SECRET' },
        body: '{"token":"REQUEST_SECRET"}',
      })
      expect(response.status).toBe(429)
      expect(response.headers.get('set-cookie')).toContain('RESPONSE_SECRET')
      expect(await response.json()).toEqual({ token: 'RESPONSE_SECRET', error: 'rate limit' })
      await recorder.flush()
      expect(observed[0]?.url).toContain('QUERY_SECRET')
      expect(observed[0]?.body.toString()).toContain('REQUEST_SECRET')
      const fixture = recorder.fixtures()[0]!
      expect(JSON.stringify(fixture)).not.toContain('SECRET')
      expect(JSON.parse(atob(fixture.request.body!.data))).toEqual({ token: '[REDACTED]' })
      expect(JSON.parse(atob(fixture.response.body!.data))).toEqual({ token: '[REDACTED]', error: 'rate limit' })
    })
  })

  it('drops oversize or unredactable captures without breaking local HTTP forwarding', async () => {
    await withBackend(async (origin, observed) => {
      for (const path of ['/large', '/invalid', '/binary']) {
        const recorder = createRecordingFetch(fetch, { maxBodyBytes: 64, redact: { jsonPointers: ['/token'] } })
        const response = await recorder.fetch(`${origin}${path}`, path === '/binary'
          ? { method: 'POST', body: 'REQUEST_SECRET'.repeat(100) }
          : undefined)
        expect(await response.text()).toContain('SECRET')
        await recorder.flush()
        expect(recorder.fixtures()).toEqual([])
        expect(recorder.errors()).toHaveLength(1)
        expect(recorder.errors()[0]?.code).toBe('capture-failed')
        expect(JSON.stringify(recorder.errors())).not.toContain('SECRET')
      }
      expect(observed).toHaveLength(3)
      expect(observed[2]?.body.toString()).toBe('REQUEST_SECRET'.repeat(100))
    })
  })

  it('bounds in-flight and retained captures without limiting forwarded requests', async () => {
    await withBackend(async (origin, observed) => {
      let release: () => void = () => {}
      const blocked = new Promise<void>((resolve) => {
        release = resolve
      })
      const recorder = createRecordingFetch(async (request) => {
        if (request.url.endsWith('/first')) {
          await blocked
        }
        return fetch(request)
      }, { maxEntries: 1, maxInFlight: 1 })
      const first = recorder.fetch(`${origin}/first`)
      try {
        expect(await (await recorder.fetch(`${origin}/second`)).text()).toBe('ok')
        expect(recorder.errors()).toEqual([{ requestId: 2, code: 'capacity', stage: 'capacity' }])
      }
      finally {
        release()
        await (await first).arrayBuffer()
      }
      await recorder.flush()
      expect(recorder.fixtures()).toHaveLength(1)
      expect(await (await recorder.fetch(`${origin}/third`)).text()).toBe('ok')
      expect(recorder.errors()).toEqual([{ requestId: 3, code: 'capacity', stage: 'capacity' }])
      expect(observed).toHaveLength(3)
    })
  })

  it('clears pending captures without cancelling upstream requests or repopulating old fixtures', async () => {
    let finish: (response: Response) => void = () => {}
    const delayed = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const forward = vi.fn((request: Request) => {
      expect(request.signal.aborted).toBe(false)
      return request.url.endsWith('/old') ? delayed : Promise.resolve(new Response('new'))
    })
    const recorder = createRecordingFetch(forward, { maxEntries: 1 })
    const old = recorder.fetch('https://local.test/old')
    recorder.clear()
    await recorder.flush()
    expect(await (await recorder.fetch('https://local.test/new')).text()).toBe('new')
    await recorder.flush()
    finish(new Response('old'))
    expect(await (await old).text()).toBe('old')
    await recorder.flush()
    expect(recorder.fixtures().map(fixture => fixture.request.url)).toEqual(['https://local.test/new'])
    expect(recorder.errors()).toEqual([])
  })

  it('returns streaming responses immediately and stops only their timed-out capture', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const source = new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value },
    }))
    const recorder = createRecordingFetch(async () => source, { bodyTimeoutMs: 15 })
    const response = await recorder.fetch('https://local.test/stream')
    try {
      expect(response).toBe(source)
      await recorder.flush()
      expect(recorder.fixtures()).toEqual([])
      expect(recorder.errors()).toEqual([{ requestId: 1, code: 'capture-failed', stage: 'response' }])
    }
    finally {
      controller!.enqueue(new TextEncoder().encode('still usable'))
      controller!.close()
      expect(await response.text()).toBe('still usable')
    }
  })

  it('propagates forward failures but retains only value-free recording diagnostics', async () => {
    const failure = new Error('UPSTREAM_SECRET')
    const recorder = createRecordingFetch(async () => {
      throw failure
    })
    await expect(recorder.fetch('https://local.test/?token=REQUEST_SECRET')).rejects.toBe(failure)
    await recorder.flush()
    expect(recorder.fixtures()).toEqual([])
    expect(recorder.errors()).toEqual([{ requestId: 1, code: 'capture-failed', stage: 'forward' }])
    expect(JSON.stringify(recorder.errors())).not.toContain('SECRET')
  })
})
