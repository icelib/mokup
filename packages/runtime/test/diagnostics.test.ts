import { describe, expect, it } from 'vitest'
import { createDiagnosticsCollector } from '../src/diagnostics'
import { createMockSession, http, HttpResponse } from '../src/http'

const request = (path: string) => new Request(`https://example.test${path}`)

describe('HTTP diagnostics', () => {
  it('correlates concurrent requests by requestId and reports untouched handler coverage', async () => {
    const session = createMockSession(
      http.get('/one', () => HttpResponse.json({ one: true })),
      http.get('/two', () => HttpResponse.json({ two: true })),
      http.post('/untouched', () => HttpResponse.text('never called')),
    )
    let timestamp = 0
    const collector = createDiagnosticsCollector(session, { now: () => ++timestamp })
    try {
      const responses = await Promise.all([session.handle(request('/one')), session.handle(request('/two'))])
      await Promise.all(responses.map(response => response?.text()))
      const snapshot = collector.snapshot()
      expect(snapshot.totals).toEqual({ started: 2, completed: 2, mocked: 2, bypassed: 0, unhandled: 0, errors: 0 })
      expect(snapshot.handlers.map(handler => [handler.matcher, handler.matched, handler.mocked])).toEqual([
        ['/one', 1, 1],
        ['/two', 1, 1],
        ['/untouched', 0, 0],
      ])
      const ids = new Set(snapshot.timeline.map(entry => entry.requestId))
      expect(ids.size).toBe(2)
      for (const id of ids) {
        const entries = snapshot.timeline.filter(entry => entry.requestId === id)
        expect(entries.map(entry => entry.type)).toEqual(['request:start', 'request:match', 'response:mocked', 'request:end'])
        expect(new Set(entries.map(entry => entry.url)).size).toBe(1)
      }
      expect(snapshot.timeline.map(entry => entry.timestamp)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      snapshot.handlers[0]!.mocked = 500
      snapshot.timeline.length = 0
      expect(collector.snapshot().handlers[0]?.mocked).toBe(1)
      expect(collector.snapshot().timeline).toHaveLength(8)
    }
    finally {
      collector.dispose()
      await session.dispose()
    }
  })

  it('bounds the event timeline while preserving aggregate counts and unhandled errors', async () => {
    const session = createMockSession({ onUnhandled: 'error' })
    const collector = createDiagnosticsCollector(session, { maxEntries: 3 })
    try {
      await expect(session.handle(request('/missing'))).rejects.toThrow('Unhandled request')
      const snapshot = collector.snapshot()
      expect(snapshot.timeline).toHaveLength(3)
      expect(snapshot.timeline.map(entry => entry.type)).toEqual(['request:unhandled', 'unhandledException', 'request:end'])
      expect(snapshot.timeline[1]?.error).toEqual({ name: 'Error', message: '[mokup] Unhandled request: GET https://example.test/missing' })
      expect(snapshot.totals).toMatchObject({ started: 1, completed: 1, errors: 1, unhandled: 1, mocked: 0 })
    }
    finally {
      collector.dispose()
      await session.dispose()
    }
  })

  it('records actionable matcher decisions for unhandled requests', async () => {
    const session = createMockSession({
      handlers: [
        http.post('/missing', () => HttpResponse.text('wrong method')),
        http.get('/other', () => HttpResponse.text('other')),
        http.get('/missing', () => HttpResponse.text('once'), { once: true }),
      ],
      onUnhandled: 'bypass',
    })
    const collector = createDiagnosticsCollector(session)
    try {
      await (await session.handle(request('/missing')))?.text()
      await session.handle(request('/missing'))
      const entry = collector.snapshot().timeline.find(item => item.type === 'request:unhandled')
      expect(entry?.decisionChain).toEqual([
        expect.objectContaining({ method: 'POST', result: 'method-mismatch' }),
        expect.objectContaining({ matcher: '/other', result: 'matcher-mismatch' }),
        expect.objectContaining({ matcher: '/missing', result: 'once-exhausted' }),
      ])
    }
    finally {
      collector.dispose()
      await session.dispose()
    }
  })

  it('records once exhaustion after a concurrent request loses the race', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const session = createMockSession({
      handlers: [http.get('/once', async () => {
        await gate
        return HttpResponse.text('ok')
      }, { once: true })],
      onUnhandled: 'bypass',
    })
    const collector = createDiagnosticsCollector(session)
    try {
      const first = session.handle(request('/once'))
      await Promise.resolve()
      const second = session.handle(request('/once'))
      release()
      const [firstResponse, secondResponse] = await Promise.all([first, second])
      expect(await firstResponse?.text()).toBe('ok')
      expect(secondResponse).toBeUndefined()
      const entry = collector.snapshot().timeline.find(item => item.type === 'request:unhandled' && item.requestId !== undefined)
      expect(entry?.decisionChain).toEqual([
        expect.objectContaining({ matcher: '/once', result: 'once-exhausted' }),
      ])
    }
    finally {
      collector.dispose()
      await session.dispose()
    }
  })

  it('retains protocol lifecycle metadata on the same diagnostic timeline', async () => {
    const session = createMockSession()
    const collector = createDiagnosticsCollector(session)
    try {
      const event = { requestId: 'ws-1', method: 'CONNECT', url: 'wss://example.test/chat', protocol: 'websocket' as const, connectionId: 'socket-1' }
      session.events.emit('protocol:start', event)
      session.events.emit('protocol:match', { ...event, matcher: '/chat' })
      session.events.emit('protocol:end', event)
      expect(collector.snapshot().timeline).toEqual([
        expect.objectContaining({ type: 'protocol:start', protocol: 'websocket', connectionId: 'socket-1' }),
        expect.objectContaining({ type: 'protocol:match', matcher: '/chat' }),
        expect.objectContaining({ type: 'protocol:end', protocol: 'websocket' }),
      ])
    }
    finally {
      collector.dispose()
      await session.dispose()
    }
  })

  it('can collect a protocol-only event bus and keeps unhandled reasons', async () => {
    const session = createMockSession()
    const collector = createDiagnosticsCollector({ events: session.events })
    try {
      const event = { requestId: 'ws-2', method: 'CONNECT', url: 'wss://example.test/missing', protocol: 'websocket' as const, connectionId: 'socket-2' }
      session.events.emit('protocol:start', event)
      session.events.emit('protocol:unhandled', { ...event, reason: 'No WebSocket link matched this URL.' })
      session.events.emit('protocol:end', event)
      expect(collector.snapshot().timeline).toEqual([
        expect.objectContaining({ type: 'protocol:start', protocol: 'websocket' }),
        expect.objectContaining({ type: 'protocol:unhandled', reason: 'No WebSocket link matched this URL.' }),
        expect.objectContaining({ type: 'protocol:end', protocol: 'websocket' }),
      ])
      expect(collector.snapshot().handlers).toEqual([])
    }
    finally {
      collector.dispose()
      await session.dispose()
    }
  })

  it('serializes metadata without consuming streams or exposing resolver functions', async () => {
    const session = createMockSession(http.get('/stream', () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('private body'))
      },
    }))))
    const collector = createDiagnosticsCollector(session)
    try {
      const response = await session.handle(request('/stream'))
      const serialized = collector.serialize()
      expect(serialized).not.toContain('private body')
      expect(serialized).not.toContain('resolver')
      expect(JSON.parse(serialized)).toMatchObject({ version: 1, totals: { mocked: 1 } })
      expect(response?.bodyUsed).toBe(false)
      const reader = response?.body?.getReader()
      expect(new TextDecoder().decode((await reader?.read())?.value)).toBe('private body')
      await reader?.cancel()
    }
    finally {
      collector.dispose()
      await session.dispose()
    }
  })

  it('tracks override coverage, resets counts, and disposes only its own subscriptions', async () => {
    const base = http.get('/item', () => HttpResponse.text('base'))
    const session = createMockSession(base)
    const collector = createDiagnosticsCollector(session)
    const other = createDiagnosticsCollector(session)
    try {
      session.use(http.get('/item', () => HttpResponse.text('override')))
      await (await session.handle(request('/item')))?.text()
      session.resetHandlers()
      expect(collector.snapshot().handlers.map(handler => handler.active)).toEqual([true, false])
      collector.clear()
      expect(collector.snapshot().timeline).toEqual([])
      expect(collector.snapshot().handlers).toHaveLength(1)
      expect(collector.snapshot().handlers[0]).toMatchObject({ matcher: '/item', matched: 0, mocked: 0 })
      collector.dispose()
      collector.dispose()
      await (await session.handle(request('/item')))?.text()
      expect(collector.snapshot().totals.started).toBe(0)
      expect(other.snapshot().totals.started).toBe(2)
    }
    finally {
      collector.dispose()
      other.dispose()
      await session.dispose()
    }
  })

  it('rejects invalid storage bounds', async () => {
    const session = createMockSession()
    for (const maxEntries of [0, -1, 0.5, Number.POSITIVE_INFINITY]) {
      expect(() => createDiagnosticsCollector(session, { maxEntries })).toThrow(RangeError)
    }
    await session.dispose()
  })
})
