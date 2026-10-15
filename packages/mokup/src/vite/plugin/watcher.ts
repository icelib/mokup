import type { PreviewServer, ViteDevServer } from 'vite'
import { isAbsolute, resolve } from 'node:path'
import chokidar from '@mokup/shared/chokidar'
import { isInDirs } from '../../shared/utils'

interface WatcherController {
  pause: () => void
  resume: () => void
  close: () => Promise<void>
}

interface WatcherOptions {
  root: string
  dirs: string[]
  refresh: (options?: { force?: boolean, silent?: boolean }) => void | Promise<void>
  onError?: (error: unknown) => void
}

interface WatcherEvents {
  on: (event: 'add' | 'change' | 'unlink' | 'raw', listener: (...args: any[]) => void) => unknown
  off: (event: 'add' | 'change' | 'unlink' | 'raw', listener: (...args: any[]) => void) => unknown
}

function normalizeWatcherFile(file: string, rootDir: string) {
  if (!file) {
    return file
  }
  if (isAbsolute(file)) {
    return file
  }
  return resolve(rootDir, file)
}

function normalizeRawWatcherPath(rawPath: unknown) {
  if (typeof rawPath === 'string') {
    return rawPath
  }
  if (rawPath && typeof (rawPath as { toString?: () => string }).toString === 'function') {
    return (rawPath as { toString: () => string }).toString()
  }
  return ''
}

function createWatcherController(params: WatcherOptions & {
  watcher: WatcherEvents
  closeWatcher?: () => Promise<void>
}): WatcherController {
  const { watcher, root } = params
  let paused = false
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let closePromise: Promise<void> | undefined
  const cancelPending = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }
  const runRefresh = async () => {
    try {
      await params.refresh({ force: true })
    }
    catch (error) {
      if (params.onError) {
        params.onError(error)
      }
      else {
        // eslint-disable-next-line no-console -- Background refresh failures have no caller to receive them.
        console.error(error)
      }
    }
  }
  const scheduleRefresh = () => {
    if (paused || closed) {
      return
    }
    cancelPending()
    timer = setTimeout(() => {
      timer = undefined
      void runRefresh()
    }, 80)
  }
  const handleWatchedFile = (file: string) => {
    const resolvedFile = normalizeWatcherFile(file, root)
    if (isInDirs(resolvedFile, params.dirs)) {
      scheduleRefresh()
    }
  }
  const handleRaw = (eventName: string, rawPath: unknown, details: unknown) => {
    if (eventName !== 'rename') {
      return
    }
    const candidate = normalizeRawWatcherPath(rawPath)
    if (!candidate) {
      return
    }
    const baseDir = typeof details === 'object' && details && 'watchedPath' in details
      ? (details as { watchedPath?: string }).watchedPath ?? root
      : root
    const resolvedFile = normalizeWatcherFile(candidate, baseDir)
    if (isInDirs(resolvedFile, params.dirs)) {
      scheduleRefresh()
    }
  }
  watcher.on('add', handleWatchedFile)
  watcher.on('change', handleWatchedFile)
  watcher.on('unlink', handleWatchedFile)
  watcher.on('raw', handleRaw)
  return {
    pause() {
      paused = true
      cancelPending()
    },
    resume() {
      if (!closed) {
        paused = false
      }
    },
    close() {
      if (!closePromise) {
        closed = true
        cancelPending()
        watcher.off('add', handleWatchedFile)
        watcher.off('change', handleWatchedFile)
        watcher.off('unlink', handleWatchedFile)
        watcher.off('raw', handleRaw)
        closePromise = Promise.resolve().then(() => params.closeWatcher?.())
      }
      return closePromise
    },
  }
}

function setupViteWatchers(params: WatcherOptions & { server: ViteDevServer }): WatcherController {
  const watcher = params.server.watcher
  watcher.add(params.dirs)
  return createWatcherController({ ...params, watcher, root: params.server.config.root ?? params.root })
}

function setupPreviewWatchers(params: WatcherOptions & { server: PreviewServer }): WatcherController {
  const watcher = chokidar.watch(params.dirs, { ignoreInitial: true })
  return createWatcherController({
    ...params,
    watcher,
    root: params.server.config.root ?? params.root,
    closeWatcher: () => watcher.close(),
  })
}

export type { WatcherController }
export { setupPreviewWatchers, setupViteWatchers }
