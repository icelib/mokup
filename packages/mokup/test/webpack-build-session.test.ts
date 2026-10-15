import type { WebpackBuildSnapshot } from '../src/webpack/plugin/build'
import { describe, expect, it, vi } from 'vitest'
import { createWebpackBuildSession } from '../src/webpack/plugin/session'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function snapshot(base = '/'): WebpackBuildSnapshot {
  return {
    root: '/root',
    base,
    state: {
      routes: [],
      serverRoutes: [],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: null,
      lastDiagnosticsSignature: null,
    },
    bundles: { swLifecycleBundle: null, swBundle: null },
  }
}

function harness(build = vi.fn().mockResolvedValue(snapshot()), previous?: Promise<void>) {
  const onRefresh = vi.fn()
  const onError = vi.fn()
  const session = createWebpackBuildSession({ build, onRefresh, onError, ...(previous ? { previous } : {}) })
  return { build, onRefresh, onError, session }
}

describe('Webpack build sessions', () => {
  it('joins concurrent compiler requests and rebuilds when idle without invalidating', async () => {
    const gate = deferred<WebpackBuildSnapshot>()
    const build = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(snapshot('/next/'))
    const { session, onRefresh } = harness(build)
    const first = session.ensureBuilt()
    const joined = session.ensureBuilt()
    expect(joined).toBe(first)
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1))
    const initial = snapshot()
    gate.resolve(initial)

    await expect(first).resolves.toBe(initial)
    expect(session.peek()).toBe(initial)
    await expect(session.ensureBuilt()).resolves.toMatchObject({ base: '/next/' })
    expect(build).toHaveBeenCalledTimes(2)
    expect(onRefresh).not.toHaveBeenCalled()
    await session.close()
  })

  it('combines refreshes into one trailing build and publishes before notifying', async () => {
    const firstGate = deferred<WebpackBuildSnapshot>()
    const secondGate = deferred<WebpackBuildSnapshot>()
    const { session, build, onRefresh } = harness(vi.fn()
      .mockReturnValueOnce(firstGate.promise)
      .mockReturnValueOnce(secondGate.promise))
    const first = session.ensureBuilt()
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1))
    const second = session.refresh()
    expect(session.refresh()).toBe(second)
    expect(session.ensureBuilt()).toBe(first)
    const completed = vi.fn()
    void second.then(completed)
    const initial = snapshot()
    firstGate.resolve(initial)
    await first
    expect(build).toHaveBeenCalledTimes(2)
    expect(completed).not.toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()
    const latest = snapshot('/latest/')
    onRefresh.mockImplementation(() => expect(session.peek()).toBe(latest))
    secondGate.resolve(latest)

    await expect(second).resolves.toBe(latest)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    await session.close()
  })

  it('waits for previous sessions and cancels work closed before the barrier', async () => {
    const previous = deferred()
    const { session, build, onRefresh } = harness(undefined, previous.promise)
    const first = session.ensureBuilt()
    const queued = session.refresh()
    await Promise.resolve()
    expect(build).not.toHaveBeenCalled()
    const drained = vi.fn()
    const closing = session.close()
    void closing.then(drained)
    expect(session.close()).toBe(closing)
    expect(session.isActive()).toBe(false)
    await expect(queued).resolves.toBeNull()
    expect(drained).not.toHaveBeenCalled()
    previous.resolve()
    await closing
    await expect(first).resolves.toBeNull()
    await expect(session.ensureBuilt()).resolves.toBeNull()
    await expect(session.refresh()).resolves.toBeNull()
    expect(build).not.toHaveBeenCalled()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('drains an in-flight build but discards its result and queued work on close', async () => {
    const gate = deferred<WebpackBuildSnapshot>()
    const { session, build, onRefresh } = harness(vi.fn().mockReturnValue(gate.promise))
    const first = session.refresh()
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1))
    const queued = session.refresh()
    const drained = vi.fn()
    const closing = session.close().then(drained)
    expect(build.mock.calls[0]?.[0]()).toBe(false)
    await expect(queued).resolves.toBeNull()
    expect(drained).not.toHaveBeenCalled()
    gate.resolve(snapshot())
    await closing
    await expect(first).resolves.toBeNull()
    expect(session.peek()).toBeNull()
    expect(build).toHaveBeenCalledTimes(1)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('starts only after the previous session has drained', async () => {
    const previous = deferred()
    const { session, build } = harness(undefined, previous.promise)
    const pending = session.ensureBuilt()
    await Promise.resolve()
    expect(build).not.toHaveBeenCalled()
    previous.resolve()
    await expect(pending).resolves.toMatchObject({ root: '/root' })
    expect(build).toHaveBeenCalledTimes(1)
    await session.close()
  })

  it('blocks builds after previous cleanup failed while settling all waiters', async () => {
    const previous = deferred()
    const { session, build, onError } = harness(undefined, previous.promise)
    const first = session.ensureBuilt()
    const queued = session.refresh()
    const error = new Error('watcher close failed')
    previous.reject(error)

    await expect(first).resolves.toBeNull()
    await expect(queued).resolves.toBeNull()
    await expect(session.refresh()).resolves.toBeNull()
    await expect(session.close()).rejects.toBe(error)
    expect(build).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledExactlyOnceWith(error)
  })

  it('retains the previous snapshot after failure and allows a queued refresh to recover', async () => {
    const gate = deferred<WebpackBuildSnapshot>()
    const initial = snapshot()
    const latest = snapshot('/latest/')
    const { session, build, onError, onRefresh } = harness(vi.fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValueOnce(latest))
    await session.ensureBuilt()
    const failure = session.refresh()
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2))
    const recovery = session.refresh()
    const error = new Error('scan failed')
    onError.mockImplementation(() => expect(session.peek()).toBe(initial))
    gate.reject(error)

    await expect(failure).resolves.toBeNull()
    await expect(recovery).resolves.toBe(latest)
    expect(onError).toHaveBeenCalledExactlyOnceWith(error)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    await session.close()
  })

  it('does not lose refresh requests in completion reactions or notification callbacks', async () => {
    const { session, build, onRefresh } = harness()
    let reentrant: Promise<WebpackBuildSnapshot | null> | undefined
    onRefresh.mockImplementationOnce(() => {
      reentrant = session.refresh()
    })
    await session.ensureBuilt().then(() => session.refresh())
    await reentrant

    expect(build).toHaveBeenCalledTimes(3)
    expect(onRefresh).toHaveBeenCalledTimes(2)
    await session.close()
  })

  it('settles waiters even when error reporting throws', async () => {
    const { session, onError } = harness(vi.fn().mockRejectedValue(new Error('scan failed')))
    onError.mockImplementation(() => {
      throw new Error('report failed')
    })
    await expect(session.refresh()).resolves.toBeNull()
    await session.close()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('suppresses late errors after shutdown', async () => {
    const gate = deferred<WebpackBuildSnapshot>()
    const { session, build, onError } = harness(vi.fn().mockReturnValue(gate.promise))
    const pending = session.refresh()
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1))
    const closing = session.close()
    gate.reject(new Error('late failure'))
    await closing
    await expect(pending).resolves.toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })
})
