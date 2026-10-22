import { describe, expect, it, vi } from 'vitest'
import { createReplay, exportHar, importHar, recordInteraction } from '../src/recording'

const url = 'https://api.example.test/orders'
const startedAt = '2026-10-05T00:00:00.000Z'

describe('finite request recordings', () => {
  it('preserves binary request and response bytes without consuming originals', async () => {
    const bytes = new Uint8Array([0, 255, 128, 65])
    const request = new Request(url, { method: 'POST', body: bytes })
    const response = new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })
    const fixture = await recordInteraction(request, response, { startedAt })
    expect(request.bodyUsed).toBe(false)
    expect(response.bodyUsed).toBe(false)
    const replay = createReplay([fixture])
    const result = await replay.handle(request)
    expect(new Uint8Array(await result!.arrayBuffer())).toEqual(bytes)
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })

  it('redacts default headers and configured URL, header and JSON fields', async () => {
    const request = new Request(`${url}?token=SECRET&q=one&token=SECOND`, {
      method: 'POST',
      headers: { 'authorization': 'Bearer SECRET', 'cookie': 'auth=SECRET', 'x-api-key': 'SECRET', 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'SECRET', nested: { 'a/b': 'SECRET' }, count: 1 }),
    })
    const response = new Response(JSON.stringify({ password: 'SECRET', count: 2 }), {
      headers: { 'content-type': 'application/json', 'set-cookie': 'token=SECRET' },
    })
    const fixture = await recordInteraction(request, response, {
      redact: { headers: ['X-API-Key'], query: ['token'], jsonPointers: ['/password', '/nested/a~1b'] },
    })
    expect(JSON.stringify(fixture)).not.toContain('SECRET')
    const result = await createReplay([fixture]).handle(new Request(`${url}?token=other&q=one&token=new`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'other', nested: { 'a/b': 'other' }, count: 1 }),
    }))
    expect(await result!.json()).toEqual({ password: '[REDACTED]', count: 2 })
    expect(result!.headers.get('set-cookie')).toBe('[REDACTED]')
    expect(await request.json()).toEqual({ password: 'SECRET', nested: { 'a/b': 'SECRET' }, count: 1 })
  })

  it('refuses malformed JSON when redaction is requested', async () => {
    const request = new Request(url)
    const response = new Response('{"secret":', { headers: { 'content-type': 'application/json' } })
    await expect(recordInteraction(request, response, { redact: { jsonPointers: ['/secret'] } })).rejects.toThrow('invalid JSON')
    await expect(response.text()).resolves.toBe('{"secret":')
  })

  it('redacts JSON MIME types with optional whitespace and structured suffixes', async () => {
    for (const contentType of ['application/json ; charset=utf-8', 'Application/Problem+JSON ; charset=utf-8']) {
      const fixture = await recordInteraction(new Request(url), new Response('{"secret":"value"}', {
        headers: { 'content-type': contentType },
      }), { redact: { jsonPointers: ['/secret'] } })
      const response = (await createReplay([fixture]).handle(new Request(url)))!
      expect(await response.json()).toEqual({ secret: '[REDACTED]' })
    }
  })

  it('enforces body byte limits without consuming source bodies', async () => {
    const response = new Response('12345')
    await expect(recordInteraction(new Request(url), response, { maxBodyBytes: 4 })).rejects.toThrow('exceeds 4 bytes')
    await expect(response.text()).resolves.toBe('12345')
    await expect(recordInteraction(new Request(url), new Response(''), { maxBodyBytes: 0 })).resolves.toBeDefined()
  })

  it('fails finite-time recording of an unclosed stream and releases timers', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const response = new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value },
    }))
    try {
      await expect(recordInteraction(new Request(url), response, { bodyTimeoutMs: 15 })).rejects.toThrow('only finite bodies')
      expect(response.bodyUsed).toBe(false)
    }
    finally {
      controller!.close()
      await response.arrayBuffer()
    }
  })

  it('rejects consumed sources and invalid options explicitly', async () => {
    const response = new Response('done')
    await response.text()
    await expect(recordInteraction(new Request(url), response)).rejects.toThrow('unused')
    await expect(recordInteraction(new Request(url), new Response(), { bodyTimeoutMs: Number.POSITIVE_INFINITY })).rejects.toThrow('finite timeout')
    await expect(recordInteraction(new Request(url), new Response(), { times: 0 })).rejects.toThrow('positive integer')
    await expect(recordInteraction(new Request(url), new Response(), { redact: { jsonPointers: ['password'] } })).rejects.toThrow('JSON pointer')
  })

  it('cancels recording a pending request body when its signal aborts', async () => {
    const abort = new AbortController()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(value) { controller = value },
    })
    const request = new Request(url, { method: 'POST', body, signal: abort.signal, duplex: 'half' } as RequestInit)
    try {
      const result = recordInteraction(request, new Response('ok'))
      const rejected = expect(result).rejects.toThrow('cancel body')
      abort.abort(new Error('cancel body'))
      await rejected
      expect(request.bodyUsed).toBe(false)
    }
    finally {
      controller!.close()
      await request.arrayBuffer()
    }
  })

  it('cancels a pending response capture when the original request aborts', async () => {
    const abort = new AbortController()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    let notifyReading: () => void = () => {}
    const reading = new Promise<void>((resolve) => {
      notifyReading = resolve
    })
    const response = new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value },
      pull() { notifyReading() },
    }, { highWaterMark: 0 }))
    try {
      const pending = recordInteraction(new Request(url, { signal: abort.signal }), response)
      const rejected = expect(pending).rejects.toThrow('cancel response')
      await reading
      abort.abort(new Error('cancel response'))
      await rejected
      expect(response.bodyUsed).toBe(false)
    }
    finally {
      controller!.close()
      await response.arrayBuffer()
    }
  })
})

describe('ordered fixture replay', () => {
  it('matches method, full URL and exact bytes and leaves misses unused', async () => {
    const fixture = await recordInteraction(new Request(`${url}?page=1`, { method: 'POST', body: 'one' }), new Response('ok'))
    const replay = createReplay([fixture])
    expect(await replay.handle(new Request(`${url}?page=2`, { method: 'POST', body: 'one' }))).toBeUndefined()
    expect(await replay.handle(new Request(`${url}?page=1`, { method: 'POST', body: 'two' }))).toBeUndefined()
    expect(await replay.handle(new Request(`${url}?page=1`))).toBeUndefined()
    expect(replay.remaining()).toEqual([1])
    expect(await (await replay.handle(new Request(`${url}?page=1`, { method: 'POST', body: 'one' })))!.text()).toBe('ok')
    expect(replay.remaining()).toEqual([0])
  })

  it('consumes duplicate recordings in order and resets isolated counters', async () => {
    const first = await recordInteraction(new Request(url), new Response('first'), { times: 2 })
    const second = await recordInteraction(new Request(url), new Response('second'))
    const fixtures = [first, second]
    const replay = createReplay(fixtures)
    const isolated = createReplay(fixtures)
    first.response.body!.data = btoa('external')
    const results = await Promise.all(Array.from({ length: 4 }, () => replay.handle(new Request(url))))
    expect(await Promise.all(results.map(response => response?.text()))).toEqual(['first', 'first', 'second', undefined])
    expect(isolated.remaining()).toEqual([2, 1])
    replay.reset()
    expect(await (await replay.handle(new Request(url)))!.text()).toBe('first')
  })

  it('reserves before replay delay and supports request cancellation', async () => {
    const fixture = await recordInteraction(new Request(url), new Response('ok'), { durationMs: 1000 })
    const replay = createReplay([fixture], { replayTiming: true })
    const controller = new AbortController()
    const pending = replay.handle(new Request(url, { signal: controller.signal }))
    const rejection = expect(pending).rejects.toThrow('stop')
    await vi.waitFor(() => expect(replay.remaining()).toEqual([0]))
    controller.abort(new Error('stop'))
    await rejection
    expect(await replay.handle(new Request(url))).toBeUndefined()
  })

  it('drops response framing and compression headers from decoded replay bytes', async () => {
    const fixture = await recordInteraction(new Request(url), new Response('decoded', {
      headers: { 'content-encoding': 'gzip', 'content-length': '999', 'transfer-encoding': 'chunked' },
    }))
    const response = (await createReplay([fixture]).handle(new Request(url)))!
    expect(response.headers.has('content-encoding')).toBe(false)
    expect(response.headers.has('content-length')).toBe(false)
    expect(await response.text()).toBe('decoded')
  })

  it('invalidates an in-flight match when reset restores fixture counters', async () => {
    const fixture = await recordInteraction(new Request(url, { method: 'POST', body: 'body' }), new Response('ok'))
    const replay = createReplay([fixture])
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const request = new Request(url, {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(value) { controller = value },
      }),
      duplex: 'half',
    } as RequestInit)
    const pending = replay.handle(request)
    const rejected = expect(pending).rejects.toThrow('Replay was reset')
    try {
      replay.reset()
      await rejected
      expect(replay.remaining()).toEqual([1])
    }
    finally {
      controller!.enqueue(new TextEncoder().encode('body'))
      controller!.close()
      await request.arrayBuffer()
    }
  })

  it('cancels owned delay timers when replay is reset', async () => {
    const fixture = await recordInteraction(new Request(url), new Response('ok'), { durationMs: 5000 })
    const replay = createReplay([fixture], { replayTiming: true })
    const pending = replay.handle(new Request(url))
    const rejected = expect(pending).rejects.toThrow('Replay was reset')
    await vi.waitFor(() => expect(replay.remaining()).toEqual([0]))
    replay.reset()
    await rejected
    expect(replay.remaining()).toEqual([1])
  })
})

describe('HTTP HAR interchange', () => {
  it('round-trips binary bodies, repeat counts, order and redaction through JSON', async () => {
    const fixture = await recordInteraction(new Request(url, { method: 'POST', body: new Uint8Array([0, 255]) }), new Response(new Uint8Array([128, 0, 255]), { status: 201, headers: { 'content-type': 'application/octet-stream' } }), { times: 3, durationMs: 7, startedAt })
    const har = exportHar([fixture])
    expect(har.log.entries[0]!.request.postData?._encoding).toBe('base64')
    expect(importHar(JSON.parse(JSON.stringify(har)))).toEqual([fixture])
    const replay = createReplay(importHar(har))
    const response = (await replay.handle(new Request(url, { method: 'POST', body: new Uint8Array([0, 255]) })))!
    expect(response.status).toBe(201)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([128, 0, 255]))
  })

  it('imports ordinary text HAR and redacts before returning fixtures', async () => {
    const fixture = await recordInteraction(new Request(url), new Response('text'), { startedAt })
    const har = exportHar([fixture])
    const entry = har.log.entries[0]!
    delete entry._mokup
    entry.request.url += '?token=SECRET'
    entry.request.headers.push({ name: 'Authorization', value: 'Bearer SECRET' })
    entry.response.content = { size: 22, mimeType: 'application/json', text: '{"password":"SECRET"}' }
    entry.response.headers = [{ name: 'Content-Type', value: 'application/json' }]
    const result = importHar(har, { redact: { query: ['token'], jsonPointers: ['/password'] } })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    const response = (await createReplay(result).handle(new Request(`${url}?token=other`)))!
    expect(await response.json()).toEqual({ password: '[REDACTED]' })
  })

  it('preserves null versus empty bodies and bodyless statuses', async () => {
    const fixtures = await Promise.all([
      recordInteraction(new Request(url), new Response(null, { status: 204 }), { startedAt }),
      recordInteraction(new Request(url), new Response(''), { startedAt }),
    ])
    expect(importHar(exportHar(fixtures))).toEqual(fixtures)
  })

  it('refuses missing HAR bodies and oversized or unsupported input', async () => {
    const fixture = await recordInteraction(new Request(url), new Response('hello'), { startedAt })
    const har = exportHar([fixture])
    expect(() => importHar(har, { maxBodyBytes: 2 })).toThrow('exceeds')
    delete har.log.entries[0]!.response.content.text
    expect(() => importHar(har)).toThrow('not captured')
    expect(() => importHar({ log: { version: '1.1', entries: [] } })).toThrow('HAR 1.2')
  })

  it.each([
    { headers: 'authorization' },
    { query: 'token' },
    { jsonPointers: ['/password', 1] },
    { replacement: null },
  ])('refuses malformed HAR redaction metadata %j', async (redact) => {
    const fixture = await recordInteraction(new Request(url), new Response('ok'), { startedAt })
    const har = exportHar([fixture])
    const entry = har.log.entries[0]!
    expect(() => importHar({
      log: { ...har.log, entries: [{ ...entry, _mokup: { ...entry._mokup, redact } }] },
    })).toThrow('Recording redaction')
  })
})
