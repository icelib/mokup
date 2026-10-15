interface RefreshWaiter {
  resolve: () => void
  reject: (error: unknown) => void
}

interface RefreshBatch {
  waiters: RefreshWaiter[]
}

/** Serialize scans while allowing explicit refreshes after watching stops. */
export function createRefreshController(
  refresh: (options: { throwOnError: boolean }) => Promise<void>,
  onError: (error: unknown) => void,
) {
  let watching = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let queued: RefreshBatch | undefined
  let running: Promise<void> | undefined

  const runNext = () => {
    if (running || !queued) {
      return
    }
    const batch = queued
    queued = undefined
    running = Promise.resolve().then(async () => {
      try {
        if (watching || batch.waiters.length > 0) {
          await refresh({ throwOnError: batch.waiters.length > 0 })
        }
        batch.waiters.forEach(waiter => waiter.resolve())
      }
      catch (error) {
        if (batch.waiters.length > 0) {
          batch.waiters.forEach(waiter => waiter.reject(error))
        }
        else {
          onError(error)
        }
      }
      finally {
        running = undefined
        runNext()
      }
    })
  }

  const enqueue = (waiter?: RefreshWaiter) => {
    queued ??= { waiters: [] }
    if (waiter) {
      queued.waiters.push(waiter)
    }
    runNext()
  }

  return {
    refresh: () => new Promise<void>((resolve, reject) => enqueue({ resolve, reject })),
    schedule() {
      if (!watching) {
        return
      }
      clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        enqueue()
      }, 80)
    },
    async stopWatching() {
      watching = false
      clearTimeout(timer)
      timer = undefined
      if (queued?.waiters.length === 0) {
        queued = undefined
      }
      let pending = running
      while (pending) {
        await pending
        pending = running
      }
    },
  }
}
