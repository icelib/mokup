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

function createSetup(kind: 'dev' | 'preview', configRoot: string | null = root) {
  const watcher = Object.assign(new EventEmitter(), {
    add: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })
  const refresh = vi.fn()
  const server = { config: { root: configRoot ?? undefined }, watcher }
  const params = { root, dirs: [mockDir], refresh }
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

describe.each(['dev', 'preview'] as const)('%s plugin watchers', (kind) => {
  it('debounces matching file events into one forced refresh', () => {
    const { watcher, refresh } = createSetup(kind)

    watcher.emit('add', path.join(mockDir, 'users.get.json'))
    watcher.emit('change', 'mock/users.get.json')
    watcher.emit('unlink', 'mock/users.get.json')
    vi.advanceTimersByTime(79)
    expect(refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledExactlyOnceWith({ force: true })
  })

  it('ignores empty paths, unrelated directories, and non-rename raw events', () => {
    const { watcher, refresh } = createSetup(kind)

    watcher.emit('add', '')
    watcher.emit('change', path.join(root, 'other/users.get.json'))
    watcher.emit('raw', 'change', 'mock/users.get.json')
    watcher.emit('raw', 'rename', null)
    watcher.emit('raw', 'rename', { toString: () => '' })
    watcher.emit('raw', 'rename', { toString: () => 'other/file.json' }, { watchedPath: root })
    vi.advanceTimersByTime(80)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('resolves raw rename events against their watched path', () => {
    const { watcher, refresh } = createSetup(kind)

    watcher.emit('raw', 'rename', { toString: () => 'users.get.json' }, { watchedPath: mockDir })
    vi.advanceTimersByTime(80)
    expect(refresh).toHaveBeenCalledExactlyOnceWith({ force: true })
  })

  it('uses the configured root for raw events without a watched path', () => {
    const { watcher, refresh } = createSetup(kind)

    watcher.emit('raw', 'rename', 'mock/users.get.json')
    watcher.emit('raw', 'rename', 'mock/users.get.json', { watchedPath: undefined })
    vi.advanceTimersByTime(80)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('falls back to the supplied root when the server root is missing', () => {
    const { watcher, refresh } = createSetup(kind, null)

    watcher.emit('raw', 'rename', 'mock/users.get.json', { watchedPath: undefined })
    vi.advanceTimersByTime(80)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('keeps the original root when the server configuration is replaced', () => {
    const { watcher, refresh, server } = createSetup(kind)
    server.config = { root: path.join(root, 'replacement') }

    watcher.emit('add', 'mock/users.get.json')
    vi.advanceTimersByTime(80)
    expect(refresh).toHaveBeenCalledOnce()
  })
})

it('adds development mock directories to the shared watcher', () => {
  const { watcher } = createSetup('dev')
  expect(watcher.add).toHaveBeenCalledExactlyOnceWith([mockDir])
})

it('creates a dedicated preview watcher without scanning initial files', () => {
  createSetup('preview')
  expect(previewMocks.watch).toHaveBeenCalledExactlyOnceWith([mockDir], { ignoreInitial: true })
})
