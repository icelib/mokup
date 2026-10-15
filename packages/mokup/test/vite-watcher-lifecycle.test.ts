import type { PreviewServer, ViteDevServer } from 'vite'
import type { WatcherController } from '../src/vite/plugin/watcher'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupPreviewWatchers, setupViteWatchers } from '../src/vite/plugin/watcher'

const root = path.resolve('/root')
const mockDir = path.join(root, 'mock')
const controllers: WatcherController[] = []
const previewMocks = vi.hoisted(() => ({ watch: vi.fn() }))

vi.mock('@mokup/shared/chokidar', () => ({
  default: { watch: previewMocks.watch },
}))

function createSetup(kind: 'dev' | 'preview', options: {
  refresh?: () => void | Promise<void>
  onError?: (error: unknown) => void
} = {}) {
  const watcher = Object.assign(new EventEmitter(), {
    add: vi.fn(),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  })
  const refresh = options.refresh ?? vi.fn()
  const server = { config: { root }, watcher, httpServer: { once: vi.fn() } }
  const params = { root, dirs: [mockDir], refresh, onError: options.onError }
  previewMocks.watch.mockReturnValue(watcher)
  const controller = kind === 'dev'
    ? setupViteWatchers({ ...params, server: server as unknown as ViteDevServer })
    : setupPreviewWatchers({ ...params, server: server as unknown as PreviewServer })
  controllers.push(controller)
  return { watcher, refresh, server, controller }
}

beforeEach(() => {
  vi.useFakeTimers()
  previewMocks.watch.mockReset()
})

afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.close()))
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe.each(['dev', 'preview'] as const)('%s watcher lifecycle', (kind) => {
  it('cancels pending refreshes while paused and resumes only on a new event', () => {
    const { controller, watcher, refresh } = createSetup(kind)

    watcher.emit('change', 'mock/users.get.json')
    vi.advanceTimersByTime(40)
    controller.pause()
    watcher.emit('raw', 'rename', 'mock/users.get.json')
    vi.advanceTimersByTime(80)
    expect(refresh).not.toHaveBeenCalled()

    controller.resume()
    vi.advanceTimersByTime(80)
    expect(refresh).not.toHaveBeenCalled()
    watcher.emit('add', 'mock/users.get.json')
    vi.advanceTimersByTime(80)
    expect(refresh).toHaveBeenCalledExactlyOnceWith({ force: true })
  })

  it('cancels a pending refresh on close and cannot resume after closing', async () => {
    const { controller, watcher, refresh } = createSetup(kind)

    watcher.emit('change', 'mock/users.get.json')
    await controller.close()
    controller.resume()
    watcher.emit('change', 'mock/users.get.json')
    vi.advanceTimersByTime(80)
    expect(refresh).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes only its own event listeners', async () => {
    const { controller, watcher } = createSetup(kind)
    const otherListener = vi.fn()
    const events = ['add', 'change', 'unlink', 'raw'] as const
    for (const event of events) {
      watcher.on(event, otherListener)
      expect(watcher.listenerCount(event)).toBe(2)
    }

    await controller.close()
    for (const event of events) {
      expect(watcher.listeners(event)).toEqual([otherListener])
    }
  })

  it.each(['throw', 'reject'] as const)('reports a refresh %s through the supplied error handler', async (failure) => {
    const error = new Error('scan failed')
    const onError = vi.fn()
    const refresh = () => {
      if (failure === 'throw') {
        throw error
      }
      return Promise.reject(error)
    }
    const { watcher } = createSetup(kind, { refresh, onError })

    watcher.emit('change', 'mock/users.get.json')
    await vi.advanceTimersByTimeAsync(80)
    expect(onError).toHaveBeenCalledExactlyOnceWith(error)
  })

  it('reports refresh errors to the console when no handler was supplied', async () => {
    const error = new Error('scan failed')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { watcher } = createSetup(kind, { refresh: () => Promise.reject(error) })

    watcher.emit('change', 'mock/users.get.json')
    await vi.advanceTimersByTimeAsync(80)
    expect(report).toHaveBeenCalledExactlyOnceWith(error)
  })
})

it('cleans up the captured development watcher without closing shared watchers', async () => {
  const { controller, server, watcher } = createSetup('dev')
  const replacement = Object.assign(new EventEmitter(), { add: vi.fn(), close: vi.fn<() => Promise<void>>() })
  const otherListener = vi.fn()
  replacement.on('change', otherListener)
  server.watcher = replacement

  await controller.close()
  expect(watcher.listenerCount('change')).toBe(0)
  expect(watcher.close).not.toHaveBeenCalled()
  expect(replacement.listeners('change')).toEqual([otherListener])
  expect(replacement.close).not.toHaveBeenCalled()
})

it('awaits dedicated preview watcher shutdown once and leaves server shutdown to the session', async () => {
  const { controller, watcher, server } = createSetup('preview')
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
    expect(server.httpServer.once).not.toHaveBeenCalled()
  }
  finally {
    finishClose()
  }
  await result
  expect(settled).toBe(true)
})
