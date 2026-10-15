import { describe, expect, it, vi } from 'vitest'
import { createRefreshController } from '../src/vite/plugin/refresh-controller'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('route refresh controller', () => {
  it('serializes scans and combines pending requests without overwriting newer state', async () => {
    const firstScan = deferred()
    const lastScan = deferred()
    let state = 'initial'
    const scan = vi.fn()
      .mockImplementationOnce(async () => {
        await firstScan.promise
        state = 'old'
      })
      .mockImplementationOnce(async () => {
        await lastScan.promise
        state = 'latest'
      })
    const controller = createRefreshController(scan)

    const first = controller.refresh({ silent: true })
    await Promise.resolve()
    const second = controller.refresh({ silent: true })
    const third = controller.refresh({ force: true })
    const tailComplete = vi.fn()
    void Promise.all([second, third]).then(tailComplete)

    expect(scan).toHaveBeenCalledTimes(1)
    firstScan.resolve()
    await first
    await Promise.resolve()
    expect(scan).toHaveBeenCalledTimes(2)
    expect(scan).toHaveBeenLastCalledWith({ force: true, silent: false })
    expect(tailComplete).not.toHaveBeenCalled()
    expect(state).toBe('old')

    lastScan.resolve()
    await Promise.all([second, third])
    expect(state).toBe('latest')
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('keeps a combined refresh silent only when every request is silent', async () => {
    const gate = deferred()
    const scan = vi.fn().mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined)
    const controller = createRefreshController(scan)
    const first = controller.refresh()
    await Promise.resolve()
    const second = controller.refresh({ silent: true })
    const third = controller.refresh({ force: true, silent: true })

    gate.resolve()
    await Promise.all([first, second, third])

    expect(scan).toHaveBeenLastCalledWith({ force: true, silent: true })
  })

  it('cancels queued work and waits for an active scan when paused', async () => {
    const gate = deferred()
    const scan = vi.fn().mockReturnValue(gate.promise)
    const controller = createRefreshController(scan)
    const active = controller.refresh()
    await Promise.resolve()
    const queued = controller.refresh({ force: true })
    const drained = vi.fn()
    const pause = controller.pause().then(drained)

    await queued
    await controller.refresh()
    expect(drained).not.toHaveBeenCalled()
    expect(scan).toHaveBeenCalledTimes(1)
    gate.resolve()
    await Promise.all([active, pause])

    controller.resume()
    await controller.refresh()
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('does not start work closed before its scan begins and cannot resume a closed controller', async () => {
    const scan = vi.fn().mockResolvedValue(undefined)
    const controller = createRefreshController(scan)
    const pending = controller.refresh()
    await controller.close()
    await pending
    controller.resume()
    await controller.refresh()

    expect(scan).not.toHaveBeenCalled()
  })

  it('preserves scan errors and still processes a later refresh', async () => {
    const gate = deferred()
    const error = new Error('Cannot load mock module')
    const scan = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(undefined)
    const controller = createRefreshController(scan)
    const first = controller.refresh()
    const rejection = expect(first).rejects.toBe(error)
    await Promise.resolve()
    const queued = controller.refresh({ force: true })

    gate.reject(error)
    await rejection
    await queued
    await controller.close()

    expect(scan).toHaveBeenCalledTimes(2)
  })
})
