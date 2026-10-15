import { EventEmitter } from 'node:events'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWebpackWatcher } from '../src/webpack/plugin/watcher'

const mockDir = path.resolve('/root/mock')
const mockFile = path.join(mockDir, 'users.get.json')
const controllers: Array<NonNullable<ReturnType<typeof createWebpackWatcher>>> = []
const mocks = vi.hoisted(() => ({ watch: vi.fn() }))

vi.mock('@mokup/shared/chokidar', () => ({ default: { watch: mocks.watch } }))

function createSetup(options: {
  onRefresh?: () => void | Promise<void>
  onError?: (error: unknown) => void
} = {}) {
  const watcher = Object.assign(new EventEmitter(), {
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  })
  mocks.watch.mockReturnValue(watcher)
  const onRefresh = options.onRefresh ?? vi.fn()
  const controller = createWebpackWatcher({
    enabled: true,
    dirs: [mockDir],
    onRefresh,
    ...(options.onError ? { onError: options.onError } : {}),
  })!
  controllers.push(controller)
  return { watcher, controller, onRefresh }
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.watch.mockReset()
})

afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.close()))
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Webpack watcher lifecycle', () => {
  it.each([
    { enabled: false, dirs: [mockDir] },
    { enabled: true, dirs: [] },
  ])('does not create a watcher for %j', (options) => {
    expect(createWebpackWatcher({ ...options, onRefresh: vi.fn() })).toBeNull()
    expect(mocks.watch).not.toHaveBeenCalled()
  })

  it('debounces matching file events and ignores unrelated paths', async () => {
    const { watcher, onRefresh } = createSetup()
    expect(mocks.watch).toHaveBeenCalledExactlyOnceWith([mockDir], { ignoreInitial: true })
    watcher.emit('add', '')
    watcher.emit('change', path.resolve('/root/other/users.get.json'))
    await vi.advanceTimersByTimeAsync(80)
    expect(onRefresh).not.toHaveBeenCalled()

    watcher.emit('add', mockFile)
    vi.advanceTimersByTime(40)
    watcher.emit('change', mockFile)
    watcher.emit('unlink', mockFile)
    await vi.advanceTimersByTimeAsync(79)
    expect(onRefresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onRefresh).toHaveBeenCalledExactlyOnceWith()
  })

  it('cancels a pending refresh when closed before the debounce expires', async () => {
    const { watcher, controller, onRefresh } = createSetup()
    watcher.emit('change', mockFile)
    vi.advanceTimersByTime(40)
    await controller.close()
    await vi.advanceTimersByTimeAsync(80)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refreshes once after the initial scan even without file events', async () => {
    const { watcher, onRefresh } = createSetup()
    watcher.emit('ready')
    await vi.advanceTimersByTimeAsync(80)
    expect(onRefresh).toHaveBeenCalledExactlyOnceWith()
    watcher.emit('ready')
    await vi.advanceTimersByTimeAsync(80)
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('coalesces readiness and file changes into one refresh', async () => {
    const { watcher, onRefresh } = createSetup()
    watcher.emit('ready')
    vi.advanceTimersByTime(40)
    watcher.emit('change', mockFile)
    await vi.advanceTimersByTimeAsync(79)
    expect(onRefresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('cancels the initial refresh when closed after readiness', async () => {
    const { watcher, controller, onRefresh } = createSetup()
    watcher.emit('ready')
    await controller.close()
    await vi.advanceTimersByTimeAsync(80)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes only its own listeners synchronously and ignores late delivery', async () => {
    const { watcher, controller, onRefresh } = createSetup()
    const lateFileEvent = watcher.listeners('change')[0]!
    const lateReadyEvent = watcher.listeners('ready')[0]!
    const events = ['ready', 'add', 'change', 'unlink'] as const
    const otherListener = vi.fn()
    for (const event of events) {
      watcher.on(event, otherListener)
      expect(watcher.listenerCount(event)).toBe(2)
    }

    const closing = controller.close()
    for (const event of events) {
      expect(watcher.listeners(event)).toEqual([otherListener])
      watcher.emit(event, mockFile)
    }
    lateFileEvent(mockFile)
    lateReadyEvent()
    await vi.advanceTimersByTimeAsync(80)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(otherListener).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
    await closing
  })

  it('ignores a scheduled callback delivered after close', async () => {
    const { watcher, controller, onRefresh } = createSetup()
    const schedule = vi.spyOn(globalThis, 'setTimeout')
    watcher.emit('change', mockFile)
    const callback = schedule.mock.calls[0]![0]
    await controller.close()
    callback()
    await Promise.resolve()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('returns one shutdown promise and awaits the underlying watcher once', async () => {
    const { watcher, controller } = createSetup()
    let finishClose!: () => void
    watcher.close.mockReturnValue(new Promise<void>((resolve) => {
      finishClose = resolve
    }))
    let settled = false
    const closing = controller.close()
    const result = closing.then(() => {
      settled = true
    })
    try {
      expect(controller.close()).toBe(closing)
      await Promise.resolve()
      expect(watcher.close).toHaveBeenCalledOnce()
      expect(settled).toBe(false)
    }
    finally {
      finishClose()
    }
    await result
    expect(settled).toBe(true)
  })

  it('leaves draining an in-flight refresh to the parent session', async () => {
    let finishRefresh!: () => void
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => {
      finishRefresh = resolve
    }))
    const { watcher, controller } = createSetup({ onRefresh })
    watcher.emit('change', mockFile)
    await vi.advanceTimersByTimeAsync(80)
    try {
      expect(onRefresh).toHaveBeenCalledOnce()
      await controller.close()
      expect(watcher.close).toHaveBeenCalledOnce()
    }
    finally {
      finishRefresh()
    }
  })

  it.each(['throw', 'reject'] as const)('reports a refresh %s to the supplied handler', async (failure) => {
    const error = new Error('Refresh failed')
    const onError = vi.fn()
    const onRefresh = () => {
      if (failure === 'throw') {
        throw error
      }
      return Promise.reject(error)
    }
    const { watcher } = createSetup({ onRefresh, onError })
    watcher.emit('change', mockFile)
    await vi.advanceTimersByTimeAsync(80)
    expect(onError).toHaveBeenCalledExactlyOnceWith(error)
  })

  it('reports refresh failures to the console without an error handler', async () => {
    const error = new Error('Refresh failed')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { watcher } = createSetup({ onRefresh: () => Promise.reject(error) })
    watcher.emit('change', mockFile)
    await vi.advanceTimersByTimeAsync(80)
    expect(report).toHaveBeenCalledExactlyOnceWith(error)
  })

  it.each(['throw', 'reject'] as const)('propagates a watcher shutdown %s without reopening', async (failure) => {
    const { watcher, controller, onRefresh } = createSetup()
    const error = new Error('Close failed')
    watcher.close.mockImplementation(() => {
      if (failure === 'throw') {
        throw error
      }
      return Promise.reject(error)
    })
    // This test handles the expected cleanup failure explicitly.
    controllers.splice(controllers.indexOf(controller), 1)
    const closing = controller.close()
    expect(controller.close()).toBe(closing)
    await expect(closing).rejects.toBe(error)
    watcher.emit('change', mockFile)
    await vi.advanceTimersByTimeAsync(80)
    expect(watcher.close).toHaveBeenCalledOnce()
    expect(onRefresh).not.toHaveBeenCalled()
  })
})
