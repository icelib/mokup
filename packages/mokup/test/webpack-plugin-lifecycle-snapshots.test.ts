import { describe, expect, it, vi } from 'vitest'
import { deferred, lifecycleSuite, mocks, requestSw, route, settle, start } from './helpers/webpack-plugin-lifecycle'

describe('webpack plugin request and compilation snapshots', () => {
  const { compiler } = lifecycleSuite()

  it('emits the compilation snapshot without rebuilding or observing a later refresh', async () => {
    const harness = compiler()
    await start(harness)
    const earlier = harness.compile()
    mocks.scanRoutes.mockImplementation(async () => [])
    await harness.hooks.beforeCompile.run()
    const later = harness.compile()
    const scans = mocks.scanRoutes.mock.calls.length

    await earlier.emit()
    await later.emit()

    expect(earlier.assets.get('mokup-sw.js')).toContain('"routes":["/initial"]')
    expect(later.assets.size).toBe(0)
    expect(earlier.html()).toHaveLength(1)
    expect(later.html()).toEqual([])
    expect(mocks.scanRoutes).toHaveBeenCalledTimes(scans)
  })

  it('does not emit assets or HTML from an old compilation after watching restarts', async () => {
    const harness = compiler()
    await start(harness)
    const earlier = harness.compile()
    harness.hooks.watchClose.call()
    harness.compiler.watching = { invalidate: vi.fn<() => void>() }
    await harness.hooks.watchRun.run(harness.compiler)
    mocks.scanRoutes.mockImplementation(async () => route('/fresh'))
    await harness.hooks.beforeCompile.run()

    await earlier.emit()
    expect(earlier.assets.size).toBe(0)
    expect(earlier.html()).toEqual([])
    const later = harness.compile()
    await later.emit()
    expect(later.assets.get('mokup-sw.js')).toContain('"routes":["/fresh"]')
    expect(later.html()).toHaveLength(1)
  })

  it('does not answer an old service worker request with a new session bundle', async () => {
    const harness = compiler()
    const middlewares = await start(harness)
    const scan = deferred<ReturnType<typeof route>>()
    const scanning = deferred<void>()
    mocks.scanRoutes.mockImplementationOnce(() => {
      scanning.resolve()
      return scan.promise
    })
    const response = requestSw(middlewares)
    await scanning.promise
    harness.hooks.watchClose.call()
    harness.compiler.watching = { invalidate: vi.fn<() => void>() }
    await harness.hooks.watchRun.run(harness.compiler)
    mocks.scanRoutes.mockImplementation(async () => route('/fresh'))
    const nextBuild = harness.hooks.beforeCompile.run()
    scan.resolve(route('/stale'))
    await nextBuild
    const oldRequest = await response

    expect(oldRequest.next).toHaveBeenCalledOnce()
    expect(oldRequest.response.end).not.toHaveBeenCalled()
    const current = await requestSw(middlewares)
    expect(current.next).not.toHaveBeenCalled()
    expect(current.response.end).toHaveBeenCalledWith(expect.stringContaining('"routes":["/fresh"]'))
  })

  it('does not resurrect a closed watcher through middleware setup or SW requests', async () => {
    const harness = compiler()
    await start(harness)
    harness.hooks.watchClose.call()
    await harness.hooks.shutdown.run()
    const scans = mocks.scanRoutes.mock.calls.length
    const middlewares = harness.setup()
    const request = await requestSw(middlewares)
    await harness.hooks.beforeCompile.run()
    await settle()

    expect(request.next).toHaveBeenCalledOnce()
    expect(request.response.end).not.toHaveBeenCalled()
    expect(mocks.scanRoutes).toHaveBeenCalledTimes(scans)
    expect(mocks.watch).toHaveBeenCalledOnce()
  })

  it('serves the last successful service worker after a rebuild fails', async () => {
    const harness = compiler()
    const middlewares = await start(harness)
    const failure = new Error('mock scanner failed')
    mocks.scanRoutes.mockRejectedValueOnce(failure)

    const request = await requestSw(middlewares)

    expect(request.next).not.toHaveBeenCalled()
    expect(request.response.statusCode).toBe(200)
    expect(request.response.end).toHaveBeenCalledWith(expect.stringContaining('"routes":["/initial"]'))
    expect(mocks.logger.error).toHaveBeenCalledWith('Failed to build mokup bundles:', failure)
  })

  it('does not answer an old SW path after the public path changes while building', async () => {
    const harness = compiler('/root/first', '/old/')
    const middlewares = await start(harness)
    const scan = deferred<ReturnType<typeof route>>()
    const scanning = deferred<void>()
    mocks.scanRoutes.mockImplementationOnce(() => {
      scanning.resolve()
      return scan.promise
    })
    const pending = requestSw(middlewares, '/old/mokup-sw.js')
    await scanning.promise
    harness.compiler.options.output!.publicPath = '/new/'
    scan.resolve(route('/stale'))
    const request = await pending

    expect(request.next).toHaveBeenCalledOnce()
    expect(request.response.end).not.toHaveBeenCalled()
  })
})
