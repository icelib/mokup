import chokidar from '@mokup/shared/chokidar'
import { isInDirs } from '../../shared/utils'

function createWebpackWatcher(params: {
  enabled: boolean
  dirs: string[]
  onRefresh: () => void | Promise<void>
  onError?: (error: unknown) => void
}) {
  if (!params.enabled || params.dirs.length === 0) {
    return null
  }
  const watcher = chokidar.watch(params.dirs, { ignoreInitial: true })
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
    if (closed) {
      return
    }
    try {
      await params.onRefresh()
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
    if (closed) {
      return
    }
    cancelPending()
    timer = setTimeout(() => {
      timer = undefined
      void runRefresh()
    }, 80)
  }
  const handleFile = (file: string) => {
    if (isInDirs(file, params.dirs)) {
      scheduleRefresh()
    }
  }
  const handleReady = () => {
    watcher.off('ready', handleReady)
    // Reconcile edits made while ignoreInitial was suppressing initial adds.
    scheduleRefresh()
  }
  watcher.on('ready', handleReady)
  watcher.on('add', handleFile)
  watcher.on('change', handleFile)
  watcher.on('unlink', handleFile)

  return {
    close() {
      if (!closePromise) {
        closed = true
        cancelPending()
        watcher.off('ready', handleReady)
        watcher.off('add', handleFile)
        watcher.off('change', handleFile)
        watcher.off('unlink', handleFile)
        closePromise = Promise.resolve().then(() => watcher.close())
      }
      return closePromise
    },
  }
}

export { createWebpackWatcher }
