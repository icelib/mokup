import type { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'
import { http, HttpResponse } from '@mokup/runtime/http'
import { describe, expect, it, vi } from 'vitest'
import { createResponseStream } from './helpers/response-stream'
import { lifecycleSuite, mocks, plugin, route, start } from './helpers/webpack-plugin-lifecycle'

const request = (path: string) => new Request(`https://webpack.test${path}`)

describe('Webpack HTTP session ownership and refresh', () => {
  const { compiler } = lifecycleSuite()

  it('serves a paused file snapshot with fresh state and releases it on compiler shutdown', async () => {
    const harness = compiler()
    const instance = plugin({ entries: { dir: 'mock', log: false }, playground: false })
    const installed = await start(harness, instance)
    const middleware = installed.find(entry => entry.name === 'mokup-mock')!.middleware
    const active = instance.api.getMockSession(harness.compiler)
    active.use(http.get('/initial', () => HttpResponse.text('override')))
    expect(await (await active.handle(request('/initial')))?.text()).toBe('override')
    harness.hooks.watchClose.call()
    await active.dispose()
    expect(() => instance.api.getMockSession(harness.compiler)).toThrow('closed')
    const scans = mocks.scanRoutes.mock.calls.length
    const invoke = async () => {
      const req = Object.assign(new EventEmitter(), { method: 'GET', url: '/initial', headers: {}, resume: vi.fn() }) as IncomingMessage
      const end = vi.fn()
      const res = createResponseStream({ setHeader: vi.fn(), end, statusCode: 0 })
      const next = vi.fn()
      await middleware(req, res as ServerResponse, next)
      return { end, res, next }
    }
    const paused = await invoke()
    expect(paused.next).not.toHaveBeenCalled()
    expect(paused.res.statusCode).toBe(200)
    expect(JSON.parse(paused.end.mock.calls[0]![0].toString())).toEqual({ url: '/initial' })
    expect(mocks.scanRoutes).toHaveBeenCalledTimes(scans)
    await harness.hooks.shutdown.run()
    const closed = await invoke()
    expect(closed.next).toHaveBeenCalledOnce()
    expect(closed.end).not.toHaveBeenCalled()
    expect(mocks.scanRoutes).toHaveBeenCalledTimes(scans)
  })

  it('retains overrides and once consumption across scans and resets to the latest file baseline', async () => {
    const harness = compiler()
    const initial = http.get('/native', () => HttpResponse.text('native'))
    const misses = vi.fn()
    const instance = plugin({
      entries: { dir: 'mock', log: false },
      playground: false,
      handlers: [initial],
      onUnhandled: misses,
    })
    expect(() => instance.api.getMockSession(harness.compiler)).toThrow('Start')
    await start(harness, instance)
    expect(mocks.logger.error).not.toHaveBeenCalled()
    const session = instance.api.getMockSession(harness.compiler)
    const override = http.get('/extra', () => HttpResponse.text('once'), { once: true })
    session.use(override)
    expect(await (await session.handle(request('/extra')))?.text()).toBe('once')
    expect(await (await session.handle(request('/native')))?.text()).toBe('native')
    mocks.scanRoutes.mockResolvedValueOnce(route('/fresh'))
    await harness.hooks.beforeCompile.run()
    expect(instance.api.getMockSession(harness.compiler)).toBe(session)
    expect(await session.handle(request('/extra'))).toBeUndefined()
    expect(misses).toHaveBeenCalledOnce()
    session.restoreHandlers()
    expect(await (await session.handle(request('/extra')))?.text()).toBe('once')
    session.resetHandlers()
    expect(session.listHandlers()).toHaveLength(2)
    expect(await (await session.handle(request('/fresh')))?.json()).toEqual({ url: '/fresh' })
    expect(await (await session.handle(request('/native')))?.text()).toBe('native')
    expect(await session.handle(request('/initial'))).toBeUndefined()
  })

  it('publishes the new HTTP baseline only after its SW bundles succeed', async () => {
    const harness = compiler()
    const instance = plugin({ entries: { dir: 'mock', mode: 'sw', log: false }, playground: false })
    await start(harness, instance)
    expect(mocks.logger.error).not.toHaveBeenCalled()
    const session = instance.api.getMockSession(harness.compiler)
    const baseline = session.listHandlers()
    mocks.scanRoutes.mockResolvedValueOnce(route('/rejected'))
    mocks.bundleScript.mockRejectedValueOnce(new Error('candidate bundle failed'))
    await harness.hooks.beforeCompile.run()
    expect(session.listHandlers()).toEqual(baseline)
    expect(await (await session.handle(request('/initial')))?.json()).toEqual({ url: '/initial' })
    expect(await session.handle(request('/rejected'))).toBeUndefined()
    mocks.scanRoutes.mockResolvedValueOnce(route('/recovered'))
    await harness.hooks.beforeCompile.run()
    expect(await (await session.handle(request('/recovered')))?.json()).toEqual({ url: '/recovered' })
    expect(await session.handle(request('/initial'))).toBeUndefined()
  })

  it('isolates compilers and permanently closes the old session when watching restarts', async () => {
    const first = compiler('/first')
    const second = compiler('/second')
    const definition = http.get('/once', () => HttpResponse.text('once'), { once: true })
    const instance = plugin({ entries: { dir: 'mock', log: false }, handlers: [definition], playground: false })
    await start(first, instance)
    await start(second, instance)
    const one = instance.api.getMockSession(first.compiler)
    const two = instance.api.getMockSession(second.compiler)
    expect(one).not.toBe(two)
    expect(await (await one.handle(request('/once')))?.text()).toBe('once')
    expect(await one.handle(request('/once'))).toBeUndefined()
    expect(await (await two.handle(request('/once')))?.text()).toBe('once')
    const cancelled = vi.fn()
    one.use(http.get('/stream', () => new HttpResponse(new ReadableStream({ cancel: cancelled }))))
    const stream = await one.handle(request('/stream'))
    first.hooks.watchClose.call()
    await first.hooks.shutdown.run()
    expect(cancelled).toHaveBeenCalledOnce()
    await expect(stream?.text()).rejects.toMatchObject({ name: 'AbortError' })
    expect(() => instance.api.getMockSession(first.compiler)).toThrow('closed')
    expect(instance.api.getMockSession(second.compiler)).toBe(two)
    first.compiler.watching = { invalidate: vi.fn<() => void>() }
    await first.hooks.watchRun.run(first.compiler)
    await first.hooks.beforeCompile.run()
    const restarted = instance.api.getMockSession(first.compiler)
    expect(restarted).not.toBe(one)
    expect(await (await restarted.handle(request('/once')))?.text()).toBe('once')
    await expect(one.handle(request('/once'))).rejects.toThrow('disposed')
  })
})
