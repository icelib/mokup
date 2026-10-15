import { describe, expect, it, vi } from 'vitest'
import { deferred, lifecycleSuite, mocks, plugin, route, settle, start } from './helpers/webpack-plugin-lifecycle'

describe('webpack plugin watch lifecycle', () => {
  const { compiler, watchers, cleanupFailures } = lifecycleSuite()

  it('cancels a pending debounce when watching closes', async () => {
    const harness = compiler()
    await start(harness)
    const before = mocks.scanRoutes.mock.calls.length
    watchers[0]!.emit('change')
    harness.hooks.watchClose.call()

    await vi.advanceTimersByTimeAsync(100)
    await harness.hooks.shutdown.run()

    expect(mocks.scanRoutes).toHaveBeenCalledTimes(before)
    expect(harness.compiler.watching.invalidate).not.toHaveBeenCalled()
    expect(watchers[0]!.close).toHaveBeenCalledOnce()
  })

  it('does not publish or invalidate when a scan finishes after watchClose', async () => {
    const harness = compiler()
    await start(harness)
    const scan = deferred<ReturnType<typeof route>>()
    mocks.scanRoutes.mockImplementationOnce(() => scan.promise)
    watchers[0]!.emit('change')
    await vi.advanceTimersByTimeAsync(80)
    harness.hooks.watchClose.call()
    scan.resolve(route('/stale'))
    await settle()
    await harness.hooks.shutdown.run()

    expect(mocks.playgrounds[0]!.getRoutes().map(entry => entry.template)).not.toContain('/stale')
    expect(harness.compiler.watching.invalidate).not.toHaveBeenCalled()
  })

  it('reuses the watcher for repeated watchRun hooks on the same Watching object', async () => {
    const harness = compiler()
    await start(harness)

    await harness.hooks.watchRun.run(harness.compiler)
    await harness.hooks.beforeCompile.run()
    await harness.hooks.watchRun.run(harness.compiler)

    expect(mocks.watch).toHaveBeenCalledOnce()
    expect(watchers[0]!.close).not.toHaveBeenCalled()
  })

  it('lets watchRun take over middleware setup that began without a Watching object', async () => {
    const harness = compiler()
    const watching = harness.compiler.watching
    Reflect.deleteProperty(harness.compiler, 'watching')
    plugin().apply(harness.compiler)
    harness.setup()
    await harness.hooks.beforeCompile.run()
    expect(mocks.watch).not.toHaveBeenCalled()

    harness.compiler.watching = watching
    await harness.hooks.watchRun.run(harness.compiler)
    await settle()
    await harness.hooks.watchRun.run(harness.compiler)

    expect(mocks.watch).toHaveBeenCalledOnce()
    expect(watchers[0]!.close).not.toHaveBeenCalled()
    expect(mocks.playgrounds[0]!.getRoutes().map(entry => entry.template)).toEqual(['/initial'])
  })

  it('waits for the old build and watcher cleanup before starting a new Watching session', async () => {
    const harness = compiler()
    await start(harness)
    const oldWatching = harness.compiler.watching
    const scan = deferred<ReturnType<typeof route>>()
    const cleanup = deferred<void>()
    mocks.scanRoutes.mockImplementationOnce(() => scan.promise)
    mocks.scanRoutes.mockImplementation(async () => route('/fresh'))
    watchers[0]!.close.mockReturnValueOnce(cleanup.promise)
    watchers[0]!.emit('change')
    await vi.advanceTimersByTimeAsync(80)
    const scanCount = mocks.scanRoutes.mock.calls.length
    harness.hooks.watchClose.call()
    harness.compiler.watching = { invalidate: vi.fn<() => void>() }
    await harness.hooks.watchRun.run(harness.compiler)
    const nextBuild = harness.hooks.beforeCompile.run()
    try {
      await settle()
      expect(mocks.watch).toHaveBeenCalledOnce()
      expect(mocks.scanRoutes).toHaveBeenCalledTimes(scanCount)
      scan.resolve(route('/stale'))
      await settle()
      expect(mocks.scanRoutes).toHaveBeenCalledTimes(scanCount)
      expect(mocks.watch).toHaveBeenCalledOnce()
    }
    finally {
      scan.resolve(route('/stale'))
      cleanup.resolve()
      await nextBuild
    }

    expect(mocks.watch).toHaveBeenCalledTimes(2)
    expect(mocks.playgrounds[0]!.getRoutes().map(entry => entry.template)).toEqual(['/fresh'])
    expect(oldWatching.invalidate).not.toHaveBeenCalled()
    expect(harness.compiler.watching.invalidate).not.toHaveBeenCalled()
  })

  it('does not commit a bundle or invalidate after its session closes', async () => {
    const harness = compiler()
    await start(harness)
    const bundle = deferred<string>()
    const bundling = deferred<void>()
    mocks.scanRoutes.mockImplementation(async () => route('/stale'))
    mocks.bundleScript.mockImplementation(async ({ code, sourceName }: { code: string, sourceName: string }) => {
      if (sourceName === 'mokup-sw.js') {
        bundling.resolve()
        return bundle.promise
      }
      return code
    })
    watchers[0]!.emit('change')
    await vi.advanceTimersByTimeAsync(80)
    await bundling.promise
    harness.hooks.watchClose.call()
    bundle.resolve('stale-bundle')
    await harness.hooks.shutdown.run()

    const compilation = harness.compile()
    await compilation.emit()
    expect(compilation.assets.size).toBe(0)
    expect(mocks.playgrounds[0]!.getRoutes().map(entry => entry.template)).not.toContain('/stale')
    expect(harness.compiler.watching.invalidate).not.toHaveBeenCalled()
  })

  it('waits for cleanup during shutdown and handles a watchClose cleanup rejection', async () => {
    const harness = compiler()
    await start(harness)
    const cleanup = deferred<void>()
    const failed = new Error('watcher failed to close')
    watchers[0]!.close.mockReturnValueOnce(cleanup.promise)
    harness.hooks.watchClose.call()
    let settled = false
    const shutdown = harness.hooks.shutdown.run().finally(() => {
      settled = true
    })
    const rejected = expect(shutdown).rejects.toThrow('Failed to close mokup')
    try {
      await settle()
      expect(settled).toBe(false)
    }
    finally {
      cleanupFailures.add(harness)
      cleanup.reject(failed)
      await rejected
    }
    expect(settled).toBe(true)
    expect(mocks.logger.error).toHaveBeenCalledWith('Failed to close mokup watcher:', expect.any(AggregateError))
    expect(watchers[0]!.close).toHaveBeenCalledOnce()
  })

  it('does not start a new watcher or scan after the old cleanup fails', async () => {
    const harness = compiler()
    await start(harness)
    const scans = mocks.scanRoutes.mock.calls.length
    const cleanup = deferred<void>()
    watchers[0]!.close.mockReturnValueOnce(cleanup.promise)
    harness.hooks.watchClose.call()
    harness.compiler.watching = { invalidate: vi.fn<() => void>() }
    await harness.hooks.watchRun.run(harness.compiler)
    let settled = false
    const nextBuild = harness.hooks.beforeCompile.run().finally(() => {
      settled = true
    })
    try {
      await settle()
      expect(settled).toBe(false)
      expect(mocks.scanRoutes).toHaveBeenCalledTimes(scans)
      expect(mocks.watch).toHaveBeenCalledOnce()
    }
    finally {
      cleanupFailures.add(harness)
      cleanup.reject(new Error('old watcher is still open'))
      await nextBuild
    }

    expect(settled).toBe(true)
    await harness.hooks.beforeCompile.run()
    expect(mocks.scanRoutes).toHaveBeenCalledTimes(scans)
    expect(mocks.watch).toHaveBeenCalledOnce()
    expect(harness.compiler.watching.invalidate).not.toHaveBeenCalled()
    const compilation = harness.compile()
    await compilation.emit()
    expect(compilation.assets.size).toBe(0)
  })

  it('allows a later non-watching run without reopening the old watcher', async () => {
    const harness = compiler()
    await start(harness)
    harness.hooks.watchClose.call()
    await harness.hooks.shutdown.run()
    Reflect.deleteProperty(harness.compiler, 'watching')
    mocks.scanRoutes.mockImplementation(async () => route('/run'))
    harness.hooks.beforeRun.call()
    await harness.hooks.beforeCompile.run()
    const compilation = harness.compile()
    await compilation.emit()

    expect(compilation.assets.get('mokup-sw.js')).toContain('"routes":["/run"]')
    expect(mocks.watch).toHaveBeenCalledOnce()
    expect(watchers[0]!.close).toHaveBeenCalledOnce()
  })

  it('keeps two compilers attached to one plugin isolated', async () => {
    const instance = plugin()
    const first = compiler('/root/first', '/first/')
    const second = compiler('/root/second', '/second/')
    mocks.scanRoutes.mockImplementation(async ({ dirs }: { dirs: string[] }) => route(dirs[0]!.includes('/first/') ? '/first' : '/second'))

    await start(first, instance)
    await start(second, instance)

    expect(mocks.watch).toHaveBeenCalledTimes(2)
    expect(mocks.watch.mock.calls.map(([dirs]) => dirs)).toEqual([['/root/first/mock'], ['/root/second/mock']])
    const firstCompilation = first.compile()
    const secondCompilation = second.compile()
    await firstCompilation.emit()
    await secondCompilation.emit()
    expect(firstCompilation.assets.get('mokup-sw.js')).toContain('"routes":["/first"]')
    expect(secondCompilation.assets.get('mokup-sw.js')).toContain('"routes":["/second"]')

    first.hooks.watchClose.call()
    await first.hooks.shutdown.run()
    expect(watchers[0]!.close).toHaveBeenCalledOnce()
    expect(watchers[1]!.close).not.toHaveBeenCalled()
  })
})
