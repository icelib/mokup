import { describe, expect, it, vi } from 'vitest'
import { createRefreshController } from '../src/fetch-server/refresh-controller'

describe('fetch refresh controller', () => {
  it('serializes scans and coalesces manual requests queued during a scan', async () => {
    vi.useFakeTimers()
    const firstScan = Promise.withResolvers<void>()
    const secondScan = Promise.withResolvers<void>()
    const scan = vi.fn()
      .mockReturnValueOnce(firstScan.promise)
      .mockReturnValueOnce(secondScan.promise)
    const controller = createRefreshController(scan, vi.fn())
    try {
      const first = controller.refresh()
      await vi.advanceTimersByTimeAsync(0)
      const second = controller.refresh()
      const third = controller.refresh()
      const settled = vi.fn()
      void Promise.all([second, third]).then(settled)
      await vi.advanceTimersByTimeAsync(0)
      expect(scan).toHaveBeenCalledExactlyOnceWith({ throwOnError: true })

      firstScan.resolve()
      await first
      await vi.advanceTimersByTimeAsync(0)
      expect(scan).toHaveBeenCalledTimes(2)
      expect(scan).toHaveBeenLastCalledWith({ throwOnError: true })
      expect(settled).not.toHaveBeenCalled()

      secondScan.resolve()
      await Promise.all([second, third])
      expect(settled).toHaveBeenCalledTimes(1)
      expect(scan).toHaveBeenCalledTimes(2)
    }
    finally {
      firstScan.resolve()
      secondScan.resolve()
      await controller.stopWatching()
      vi.useRealTimers()
    }
  })

  it('debounces watcher events until the last event has been quiet for 80 ms', async () => {
    vi.useFakeTimers()
    const scan = vi.fn().mockResolvedValue(undefined)
    const controller = createRefreshController(scan, vi.fn())
    try {
      controller.schedule()
      await vi.advanceTimersByTimeAsync(79)
      expect(scan).not.toHaveBeenCalled()
      controller.schedule()
      await vi.advanceTimersByTimeAsync(79)
      expect(scan).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(scan).toHaveBeenCalledExactlyOnceWith({ throwOnError: false })
      expect(vi.getTimerCount()).toBe(0)
    }
    finally {
      await controller.stopWatching()
      vi.useRealTimers()
    }
  })

  it('cancels debounce on stop and still accepts explicit refreshes afterwards', async () => {
    vi.useFakeTimers()
    const scan = vi.fn().mockResolvedValue(undefined)
    const controller = createRefreshController(scan, vi.fn())
    try {
      controller.schedule()
      await controller.stopWatching()
      expect(vi.getTimerCount()).toBe(0)
      controller.schedule()
      await vi.advanceTimersByTimeAsync(160)
      expect(scan).not.toHaveBeenCalled()

      await controller.refresh()
      expect(scan).toHaveBeenCalledExactlyOnceWith({ throwOnError: true })
      await controller.stopWatching()
      expect(vi.getTimerCount()).toBe(0)
    }
    finally {
      await controller.stopWatching()
      vi.useRealTimers()
    }
  })

  it('drains an active scan and discards queued watcher work when stopped', async () => {
    vi.useFakeTimers()
    const activeScan = Promise.withResolvers<void>()
    const scan = vi.fn().mockReturnValue(activeScan.promise)
    const controller = createRefreshController(scan, vi.fn())
    try {
      controller.schedule()
      await vi.advanceTimersByTimeAsync(80)
      controller.schedule()
      await vi.advanceTimersByTimeAsync(80)
      expect(scan).toHaveBeenCalledExactlyOnceWith({ throwOnError: false })

      const stopped = vi.fn()
      const stopping = controller.stopWatching().then(stopped)
      await vi.advanceTimersByTimeAsync(0)
      expect(stopped).not.toHaveBeenCalled()
      activeScan.resolve()
      await stopping
      await vi.advanceTimersByTimeAsync(160)
      expect(stopped).toHaveBeenCalledTimes(1)
      expect(scan).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    }
    finally {
      activeScan.resolve()
      await controller.stopWatching()
      vi.useRealTimers()
    }
  })

  it('drains pending manual refreshes even when their batch also contains watcher work', async () => {
    vi.useFakeTimers()
    const firstScan = Promise.withResolvers<void>()
    const secondScan = Promise.withResolvers<void>()
    const scan = vi.fn()
      .mockReturnValueOnce(firstScan.promise)
      .mockReturnValueOnce(secondScan.promise)
    const controller = createRefreshController(scan, vi.fn())
    try {
      controller.schedule()
      await vi.advanceTimersByTimeAsync(80)
      controller.schedule()
      await vi.advanceTimersByTimeAsync(80)
      const firstManual = controller.refresh()
      const secondManual = controller.refresh()
      const stopped = vi.fn()
      const stopping = controller.stopWatching().then(stopped)

      firstScan.resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(scan.mock.calls).toEqual([[{ throwOnError: false }], [{ throwOnError: true }]])
      expect(stopped).not.toHaveBeenCalled()

      secondScan.resolve()
      await Promise.all([firstManual, secondManual, stopping])
      expect(stopped).toHaveBeenCalledTimes(1)
      expect(scan).toHaveBeenCalledTimes(2)
    }
    finally {
      firstScan.resolve()
      secondScan.resolve()
      await controller.stopWatching()
      vi.useRealTimers()
    }
  })

  it('does not start background work if stopped before its execution microtask', async () => {
    vi.useFakeTimers()
    const scan = vi.fn().mockResolvedValue(undefined)
    const controller = createRefreshController(scan, vi.fn())
    try {
      controller.schedule()
      vi.advanceTimersByTime(80)
      await controller.stopWatching()
      expect(scan).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
    finally {
      await controller.stopWatching()
      vi.useRealTimers()
    }
  })

  it('reports background failures once and processes later watcher events', async () => {
    vi.useFakeTimers()
    const failure = new Error('background scan failed')
    const scan = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    const onError = vi.fn()
    const controller = createRefreshController(scan, onError)
    try {
      controller.schedule()
      await vi.advanceTimersByTimeAsync(80)
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure)

      controller.schedule()
      await vi.advanceTimersByTimeAsync(80)
      expect(scan.mock.calls).toEqual([[{ throwOnError: false }], [{ throwOnError: false }]])
      expect(onError).toHaveBeenCalledTimes(1)
      await expect(controller.stopWatching()).resolves.toBeUndefined()
    }
    finally {
      await controller.stopWatching()
      vi.useRealTimers()
    }
  })

  it('rejects every manual waiter on failure without reporting a background error, then recovers', async () => {
    vi.useFakeTimers()
    const firstScan = Promise.withResolvers<void>()
    const secondScan = Promise.withResolvers<void>()
    const failure = new Error('explicit scan failed')
    const scan = vi.fn()
      .mockReturnValueOnce(firstScan.promise)
      .mockReturnValueOnce(secondScan.promise)
      .mockResolvedValue(undefined)
    const onError = vi.fn()
    const controller = createRefreshController(scan, onError)
    try {
      const first = controller.refresh()
      await vi.advanceTimersByTimeAsync(0)
      const second = expect(controller.refresh()).rejects.toBe(failure)
      const third = expect(controller.refresh()).rejects.toBe(failure)
      firstScan.resolve()
      await first
      await vi.advanceTimersByTimeAsync(0)
      secondScan.reject(failure)
      await Promise.all([second, third])
      expect(onError).not.toHaveBeenCalled()

      await expect(controller.refresh()).resolves.toBeUndefined()
      expect(scan).toHaveBeenCalledTimes(3)
      expect(scan).toHaveBeenLastCalledWith({ throwOnError: true })
      expect(onError).not.toHaveBeenCalled()
    }
    finally {
      firstScan.resolve()
      secondScan.resolve()
      await controller.stopWatching()
      vi.useRealTimers()
    }
  })
})
