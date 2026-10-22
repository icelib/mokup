import { describe, expect, it, vi } from 'vitest'
import { createMockSession, http, HttpResponse, networkError, passthrough } from '../src/http'
import { createScenario, createScenarioCatalog } from '../src/scenario'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const request = () => new Request('https://example.test/item')

describe('HTTP mock sessions', () => {
  it('detaches request abort listeners when a request:start subscriber throws', async () => {
    const session = createMockSession()
    const source = request()
    const added = vi.spyOn(source.signal, 'addEventListener')
    const removed = vi.spyOn(source.signal, 'removeEventListener')
    const error = new Error('subscriber failed')
    session.events.on('request:start', () => {
      throw error
    })
    await expect(session.handle(source)).rejects.toBe(error)
    const listener = added.mock.calls.find(([type]) => type === 'abort')?.[1]
    expect(listener).toBeTypeOf('function')
    expect(removed).toHaveBeenCalledWith('abort', listener)
    await session.dispose()
  })

  it('merges copied transport cookies with explicit request cookies taking priority', async () => {
    const session = createMockSession(http.get('/item', ({ cookies }) => HttpResponse.json(cookies)))
    const context = { cookies: { token: 'metadata', other: 'before' } }
    const pending = session.handle(new Request('https://example.test/item', { headers: { cookie: 'token=header' } }), context)
    context.cookies.other = 'after'
    expect(await (await pending)?.json()).toEqual({ token: 'header', other: 'before' })
    const fork = session.fork()
    expect(await (await fork.handle(request(), { cookies: { token: 'fork' } }))?.json()).toEqual({ token: 'fork' })
    expect(await (await session.handle(request()))?.json()).toEqual({})
    await Promise.all([session.dispose(), fork.dispose()])
  })

  it('consumes once handlers atomically for simultaneous requests', async () => {
    const entered = deferred()
    const release = deferred()
    let calls = 0
    const session = createMockSession(
      http.get('/item', async () => {
        calls++
        entered.resolve()
        await release.promise
        return HttpResponse.text('first')
      }, { once: true }),
      http.get('/item', () => HttpResponse.text('fallback')),
    )
    const first = session.handle(request())
    await entered.promise
    const others = Array.from({ length: 10 }, () => session.handle(request()))
    release.resolve()
    expect(await (await first)?.text()).toBe('first')
    expect(await Promise.all((await Promise.all(others)).map(response => response?.text()))).toEqual(Array.from({ length: 10 }).fill('fallback'))
    expect(calls).toBe(1)
    await session.dispose()
  })

  it('does not consume a once handler when its resolver returns undefined', async () => {
    let calls = 0
    const session = createMockSession(http.get('/item', () => {
      calls++
      return calls === 1 ? undefined : HttpResponse.text('second')
    }, { once: true }))
    const responses = await Promise.all([session.handle(request()), session.handle(request())])
    expect(responses[0]).toBeUndefined()
    expect(await responses[1]?.text()).toBe('second')
    expect(await session.handle(request())).toBeUndefined()
    await session.dispose()
  })

  it('isolates once state between sessions and forks', async () => {
    const handler = http.get('/item', () => HttpResponse.text('once'), { once: true })
    const first = createMockSession(handler)
    const second = createMockSession(handler)
    expect(await (await first.handle(request()))?.text()).toBe('once')
    expect(await first.handle(request())).toBeUndefined()
    expect(await (await second.handle(request()))?.text()).toBe('once')
    const fork = first.fork()
    expect(await (await fork.handle(request()))?.text()).toBe('once')
    await Promise.all([first.dispose(), second.dispose(), fork.dispose()])
  })

  it('prepends overrides and restores the original definitions on reset', async () => {
    const initial = http.get('/item', () => HttpResponse.text('initial'), { once: true })
    const override = http.get('/item', () => HttpResponse.text('override'))
    const session = createMockSession(initial)
    session.use(override)
    const fork = session.fork()
    expect(fork.listHandlers()).toEqual([override, initial])
    fork.resetHandlers()
    expect(fork.listHandlers()).toEqual([initial])
    await fork.dispose()
    expect(session.listHandlers()).toEqual([override, initial])
    expect(await (await session.handle(request()))?.text()).toBe('override')
    session.resetHandlers()
    expect(await (await session.handle(request()))?.text()).toBe('initial')
    expect(await session.handle(request())).toBeUndefined()
    session.restoreHandlers()
    expect(await (await session.handle(request()))?.text()).toBe('initial')
    session.resetHandlers(override)
    expect(session.listHandlers()).toEqual([override])
    await session.dispose()
    await expect(session.handle(request())).rejects.toThrow('disposed')
    expect(() => session.use(initial)).toThrow('disposed')
  })

  it('emits metadata-only events in request order and supports subscriptions', async () => {
    const session = createMockSession(http.get('/item', () => HttpResponse.text('body')))
    const events: string[] = []
    let requestId: string | undefined
    const unsubscribe = session.events.on('request:start', (event) => {
      events.push('start')
      requestId = event.requestId
      expect(Object.keys(event).sort()).toEqual(['method', 'requestId', 'url'])
    })
    session.events.on('request:match', () => events.push('match'))
    session.events.on('response:mocked', event => events.push(`response:${event.status}`))
    session.events.on('request:end', (event) => {
      expect(event.requestId).toBe(requestId)
      events.push('end')
    })
    expect(await (await session.handle(request()))?.text()).toBe('body')
    expect(events).toEqual(['start', 'match', 'response:200', 'end'])
    unsubscribe()
    session.events.removeAllListeners()
    await session.dispose()
  })

  it('restores once consumption while preserving its earlier live response', async () => {
    const cancelled = vi.fn()
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
    const session = createMockSession(http.get('/item', () => new HttpResponse(new ReadableStream<Uint8Array>({
      start(controller) { controllers.push(controller) },
      cancel: cancelled,
    })), { once: true }))
    try {
      const first = await session.handle(request())
      session.restoreHandlers()
      const second = await session.handle(request())
      for (const [index, controller] of controllers.entries()) {
        controller.enqueue(new TextEncoder().encode(String(index)))
        controller.close()
      }
      expect(await first?.text()).toBe('0')
      expect(await second?.text()).toBe('1')
      expect(cancelled).not.toHaveBeenCalled()
      expect(await session.handle(request())).toBeUndefined()
    }
    finally {
      await session.dispose()
    }
  })

  it('supports strict, warning, callback, and bypass unhandled policies', async () => {
    const session = createMockSession({ onUnhandled: 'error' })
    await expect(session.handle(request())).rejects.toThrow('Unhandled request: GET')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    session.setOnUnhandled('warn')
    expect(await session.handle(request())).toBeUndefined()
    expect(warning).toHaveBeenCalledOnce()
    warning.mockRestore()
    const callback = vi.fn()
    session.setOnUnhandled(callback)
    await session.handle(request())
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET' }), expect.objectContaining({ request: expect.any(Function) }))
    session.setOnUnhandled('bypass')
    expect(await session.handle(request())).toBeUndefined()
    await session.dispose()
  })

  it('does not mark explicit passthrough or network errors as unhandled', async () => {
    const session = createMockSession({
      handlers: [http.get('/item', () => passthrough())],
      onUnhandled: 'error',
    })
    expect(await session.handle(request())).toBeUndefined()
    session.use(http.get('/item', networkError))
    const response = await session.handle(request())
    expect(response?.type).toBe('error')
    expect(response?.status).toBe(0)
    await session.dispose()
  })

  it('binds an isolated scenario catalog to resolver context and forks', async () => {
    const catalog = createScenarioCatalog({
      happy: createScenario('happy', { mode: 'happy' }),
      error: createScenario('error', { mode: 'error' }),
    })
    const handler = http.get('/item', ({ scenario }) => HttpResponse.json({ mode: scenario?.current().getState() }))
    const session = createMockSession({ handlers: [handler], scenario: catalog })
    expect(session.scenario?.active()).toBe('happy')
    session.selectScenario('error')
    expect(await (await session.handle(request()))?.json()).toEqual({ mode: { mode: 'error' } })
    const fork = session.fork()
    fork.selectScenario('happy')
    expect(await (await fork.handle(request()))?.json()).toEqual({ mode: { mode: 'happy' } })
    expect(session.scenario?.active()).toBe('error')
    session.resetScenario()
    expect(session.scenario?.active()).toBe('happy')
    await Promise.all([session.dispose(), fork.dispose()])
  })
})
