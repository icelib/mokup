export interface RefreshOptions {
  force?: boolean
  silent?: boolean
}

interface RefreshBatch {
  options: RefreshOptions | undefined
  waiters: Array<{ resolve: () => void, reject: (error: unknown) => void }>
}

/** Serialize scans and combine requests received while a scan is running. */
export function createRefreshController(refresh: (options?: RefreshOptions) => Promise<void>) {
  let paused = false
  let closed = false
  let queued: RefreshBatch | null = null
  let running: Promise<void> | null = null

  const runNext = () => {
    if (paused || running || !queued) {
      return
    }
    const batch = queued
    queued = null
    running = (async () => {
      // Track the promise before invoking a scan that can itself request a refresh.
      await Promise.resolve()
      try {
        if (!paused) {
          await refresh(batch.options)
        }
        batch.waiters.forEach(waiter => waiter.resolve())
      }
      catch (error) {
        batch.waiters.forEach(waiter => waiter.reject(error))
      }
      finally {
        running = null
        runNext()
      }
    })()
  }

  const request = (options?: RefreshOptions): Promise<void> => {
    if (paused || closed) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      if (queued) {
        queued.options = {
          force: queued.options?.force === true || options?.force === true,
          silent: queued.options?.silent === true && options?.silent === true,
        }
        queued.waiters.push({ resolve, reject })
      }
      else {
        queued = { options, waiters: [{ resolve, reject }] }
      }
      runNext()
    })
  }

  const pause = () => {
    paused = true
    queued?.waiters.forEach(waiter => waiter.resolve())
    queued = null
    return running ?? Promise.resolve()
  }

  return {
    refresh: request,
    pause,
    resume() {
      if (!closed) {
        paused = false
      }
    },
    close() {
      closed = true
      return pause()
    },
  }
}
