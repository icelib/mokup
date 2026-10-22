import { describe, expect, it, vi } from 'vitest'
import { createMockSession, delay, http, HttpResponse } from '../src/http'
import { createPluginHost } from '../src/plugin'

const request = () => new Request('https://example.test/item')

describe('mock plugin host', () => {
  it('registers extension resources with lifecycle ownership and metadata-only discovery', async () => {
    const session = createMockSession()
    const host = createPluginHost(session)
    const disposed = vi.fn()
    const resource = { kind: 'storage' as const, name: 'memory', value: { get: () => 'secret' }, dispose: disposed }
    try {
      await host.use({ name: 'storage-plugin', setup(context) {
        context.registerResource(resource)
        expect(context.listResources()).toEqual([{ kind: 'storage', name: 'memory', plugin: 'storage-plugin' }])
      } })
      expect(host.listResources()).toEqual([{ kind: 'storage', name: 'memory', plugin: 'storage-plugin' }])
      await expect(host.use({ name: 'duplicate', setup(context) {
        context.registerResource({ kind: 'storage', name: 'memory', value: {} })
      } })).rejects.toThrow('unique')
      expect(host.listResources()).toEqual([{ kind: 'storage', name: 'memory', plugin: 'storage-plugin' }])
      await host.dispose()
      expect(disposed).toHaveBeenCalledOnce()
      expect(host.listResources()).toEqual([])
    }
    finally {
      await host.dispose()
      await session.dispose()
    }
  })

  it('removes only plugin definitions and subscriptions while preserving user overrides and once state', async () => {
    const once = http.get('/item', () => HttpResponse.text('once'), { once: true })
    const base = http.get('/item', () => HttpResponse.text('base'))
    const session = createMockSession(once, base)
    const host = createPluginHost(session)
    const observed = vi.fn()
    const released = vi.fn()
    try {
      expect(await (await session.handle(request()))?.text()).toBe('once')
      await host.use({ name: 'override', setup(context) {
        context.use(http.get('/item', () => HttpResponse.text('plugin')))
        context.events.on('request:start', observed)
        return released
      } })
      expect(await (await session.handle(request()))?.text()).toBe('plugin')
      const user = http.get('/item', () => HttpResponse.text('user'))
      session.use(user)
      await host.dispose()
      expect(session.listHandlers()).toEqual([user, once, base])
      session.removeHandlers(user)
      expect(await (await session.handle(request()))?.text()).toBe('base')
      expect(released).toHaveBeenCalledOnce()
      expect(observed).toHaveBeenCalledOnce()
      expect(host.list()).toEqual([])
      await host.dispose()
      expect(released).toHaveBeenCalledOnce()
      await expect(host.use({ name: 'late', setup() {} })).rejects.toThrow('disposed')
    }
    finally {
      await host.dispose()
      await session.dispose()
    }
  })

  it('rolls back a failing batch in reverse order, including resources registered before setup throws', async () => {
    const session = createMockSession()
    const host = createPluginHost(session)
    const released: string[] = []
    try {
      await host.use({ name: 'existing', setup(context) {
        context.use(http.get('/existing', () => HttpResponse.text('keep')))
        return () => {
          released.push('existing')
        }
      } })
      await expect(host.use(
        { name: 'first', setup(context) {
          context.use(http.get('/item', () => HttpResponse.text('first')))
          context.defer(() => {
            released.push('first-deferred')
          })
          return () => {
            released.push('first-returned')
          }
        } },
        { name: 'second', setup(context) {
          context.use(http.get('/item', () => HttpResponse.text('second')))
          context.defer(() => {
            released.push('second')
          })
          throw new Error('broken setup')
        } },
      )).rejects.toThrow('broken setup')
      expect(released).toEqual(['second', 'first-returned', 'first-deferred'])
      expect(host.list()).toEqual(['existing'])
      expect(session.listHandlers()).toHaveLength(1)
      expect(await session.handle(request())).toBeUndefined()
      await host.use({ name: 'first', setup() {} })
      expect(host.list()).toEqual(['existing', 'first'])
    }
    finally {
      await host.dispose()
      await session.dispose()
    }
    expect(released.at(-1)).toBe('existing')
  })

  it('reserves names before asynchronous setup and rejects duplicates without running them', async () => {
    const session = createMockSession()
    const host = createPluginHost(session)
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const duplicate = vi.fn()
    try {
      const initial = host.use({ name: 'same', setup: () => pending })
      await expect(host.use({ name: 'same', setup: duplicate })).rejects.toThrow('unique')
      await expect(host.use({ name: 'a', setup: duplicate }, { name: 'a', setup: duplicate })).rejects.toThrow('unique')
      expect(duplicate).not.toHaveBeenCalled()
      finish()
      await initial
      expect(host.list()).toEqual(['same'])
    }
    finally {
      finish()
      await host.dispose()
      await session.dispose()
    }
  })

  it('aborts setup in progress and awaits its returned disposer', async () => {
    const session = createMockSession()
    const host = createPluginHost(session)
    const released = vi.fn()
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const installing = host.use({ name: 'pending', async setup({ signal }) {
      started()
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      return released
    } })
    const rejected = expect(installing).rejects.toMatchObject({ name: 'AbortError' })
    await ready
    await host.dispose()
    await rejected
    expect(released).toHaveBeenCalledOnce()
    expect(host.list()).toEqual([])
    await session.dispose()
  })

  it('aborts in-flight plugin resolvers without disposing the caller-owned session', async () => {
    const session = createMockSession(http.get('/item', () => HttpResponse.text('base')))
    const host = createPluginHost(session)
    const finalized = vi.fn()
    let entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    await host.use({ name: 'pending-request', setup({ use }) {
      use(http.get('/item', async ({ request, finalize }) => {
        finalize(finalized)
        entered()
        await delay('infinite', { signal: request.signal })
        return HttpResponse.text('unreachable')
      }))
    } })
    const pending = session.handle(request())
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await ready
    await host.dispose()
    await rejected
    expect(finalized).toHaveBeenCalledOnce()
    expect(await (await session.handle(request()))?.text()).toBe('base')
    await session.dispose()
  })

  it('cancels plugin response streams and finalizers during disposal', async () => {
    const session = createMockSession()
    const host = createPluginHost(session)
    const cancel = vi.fn()
    const finalize = vi.fn()
    await host.use({ name: 'stream', setup({ use }) {
      use(http.get('/item', (context) => {
        context.finalize(finalize)
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode('chunk')) },
          cancel,
        }))
      }))
    } })
    const response = await session.handle(request())
    const reader = response?.body?.getReader()
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe('chunk')
    await host.dispose()
    await expect(reader?.read()).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(finalize).toHaveBeenCalledOnce()
    await session.dispose()
  })

  it('continues reverse cleanup after a disposer fails', async () => {
    const session = createMockSession()
    const host = createPluginHost(session)
    const released = vi.fn()
    await host.use(
      { name: 'first', setup: () => released },
      { name: 'broken', setup: () => () => { throw new Error('release failed') } },
    )
    await expect(host.dispose()).rejects.toThrow(AggregateError)
    expect(released).toHaveBeenCalledOnce()
    expect(host.list()).toEqual([])
    await session.dispose()
  })

  it('awaits asynchronous generator cleanup without disposing the caller session', async () => {
    const session = createMockSession(http.get('/item', () => HttpResponse.text('base')))
    const host = createPluginHost(session)
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const finalized = vi.fn()
    await host.use({ name: 'sequence', setup({ use }) {
      use(http.get('/item', async function* ({ finalize }) {
        finalize(finalized)
        try {
          yield HttpResponse.text('first')
          yield HttpResponse.text('second')
        }
        finally {
          entered.resolve()
          await release.promise
        }
      }))
    } })
    expect(await (await session.handle(request()))?.text()).toBe('first')
    let disposed = false
    const pending = host.dispose().then(() => {
      disposed = true
    })
    await entered.promise
    await delay(1)
    expect(disposed).toBe(false)
    release.resolve()
    await pending
    expect(finalized).toHaveBeenCalledOnce()
    expect(await (await session.handle(request()))?.text()).toBe('base')
    await session.dispose()
  })
})
