import { describe, expect, it, vi } from 'vitest'
import { deferred, lifecycleSuite, mocks, plugin, route, settle, start } from './helpers/webpack-plugin-lifecycle'

describe('webpack plugin watcher readiness', () => {
  const { compiler, watchers } = lifecycleSuite()

  it('reconciles readiness after an in-flight initial scan before invalidating', async () => {
    const harness = compiler()
    const initialScan = deferred<ReturnType<typeof route>>()
    const readyScan = deferred<ReturnType<typeof route>>()
    const initialScanning = deferred<void>()
    const readyScanning = deferred<void>()
    mocks.scanRoutes.mockImplementationOnce(() => {
      initialScanning.resolve()
      return initialScan.promise
    }).mockImplementationOnce(() => {
      readyScanning.resolve()
      return readyScan.promise
    })
    plugin().apply(harness.compiler)
    await harness.hooks.watchRun.run(harness.compiler)
    harness.setup()
    const initialBuild = harness.hooks.beforeCompile.run()

    try {
      await initialScanning.promise
      watchers[0]!.emit('ready')
      await vi.advanceTimersByTimeAsync(80)
      expect(mocks.scanRoutes).toHaveBeenCalledOnce()
      expect(harness.compiler.watching.invalidate).not.toHaveBeenCalled()

      initialScan.resolve(route('/initial'))
      await initialBuild
      await readyScanning.promise
      expect(mocks.scanRoutes).toHaveBeenCalledTimes(2)
      expect(mocks.playgrounds[0]!.getRoutes().map(entry => entry.template)).toEqual(['/initial'])
      expect(harness.compiler.watching.invalidate).not.toHaveBeenCalled()

      readyScan.resolve(route('/ready'))
      await settle()
      expect(mocks.playgrounds[0]!.getRoutes().map(entry => entry.template)).toEqual(['/ready'])
      expect(harness.compiler.watching.invalidate).toHaveBeenCalledOnce()
      const compilation = harness.compile()
      await compilation.emit()
      expect(compilation.assets.get('mokup-sw.js')).toContain('"routes":["/ready"]')
    }
    finally {
      initialScan.resolve(route('/initial'))
      readyScan.resolve(route('/ready'))
      await initialBuild
    }
  })

  it('ignores the old ready event after restarting while reconciling the new watcher', async () => {
    const harness = compiler()
    await start(harness)
    const oldWatcher = watchers[0]!
    const oldWatching = harness.compiler.watching
    const oldReady = oldWatcher.on.mock.calls.find(([event]) => event === 'ready')![1]
    harness.hooks.watchClose.call()
    harness.compiler.watching = { invalidate: vi.fn<() => void>() }
    mocks.scanRoutes.mockResolvedValueOnce(route('/restarted'))
    await harness.hooks.watchRun.run(harness.compiler)
    await harness.hooks.beforeCompile.run()
    const scans = mocks.scanRoutes.mock.calls.length

    oldWatcher.emit('ready')
    // Simulate a callback already delivered before its listener was removed.
    oldReady('')
    await vi.advanceTimersByTimeAsync(80)
    expect(mocks.scanRoutes).toHaveBeenCalledTimes(scans)
    expect(oldWatcher.close).toHaveBeenCalledOnce()
    expect(oldWatching.invalidate).not.toHaveBeenCalled()
    expect(harness.compiler.watching.invalidate).not.toHaveBeenCalled()
    expect(mocks.playgrounds[0]!.getRoutes().map(entry => entry.template)).toEqual(['/restarted'])

    mocks.scanRoutes.mockResolvedValueOnce(route('/ready'))
    watchers[1]!.emit('ready')
    await vi.advanceTimersByTimeAsync(80)
    expect(mocks.scanRoutes).toHaveBeenCalledTimes(scans + 1)
    expect(mocks.playgrounds[0]!.getRoutes().map(entry => entry.template)).toEqual(['/ready'])
    expect(oldWatching.invalidate).not.toHaveBeenCalled()
    expect(harness.compiler.watching.invalidate).toHaveBeenCalledOnce()
  })

  it('retains the last successful snapshot after a ready refresh fails and recovers on change', async () => {
    const harness = compiler()
    await start(harness)
    const failure = new Error('ready scan failed')
    mocks.scanRoutes.mockRejectedValueOnce(failure)
    watchers[0]!.emit('ready')
    await vi.advanceTimersByTimeAsync(80)

    expect(mocks.logger.error).toHaveBeenCalledWith('Failed to build mokup bundles:', failure)
    expect(mocks.playgrounds[0]!.getRoutes().map(entry => entry.template)).toEqual(['/initial'])
    expect(harness.compiler.watching.invalidate).not.toHaveBeenCalled()
    const retained = harness.compile()
    await retained.emit()
    expect(retained.assets.get('mokup-sw.js')).toContain('"routes":["/initial"]')

    mocks.scanRoutes.mockResolvedValueOnce(route('/recovered'))
    watchers[0]!.emit('change')
    await vi.advanceTimersByTimeAsync(80)
    expect(mocks.playgrounds[0]!.getRoutes().map(entry => entry.template)).toEqual(['/recovered'])
    expect(harness.compiler.watching.invalidate).toHaveBeenCalledOnce()
    const recovered = harness.compile()
    await recovered.emit()
    expect(recovered.assets.get('mokup-sw.js')).toContain('"routes":["/recovered"]')
  })
})
