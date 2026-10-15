import type { WebpackBuildSnapshot } from './build'

interface BuildBatch {
  refresh: boolean
  promise: Promise<WebpackBuildSnapshot | null>
  resolve: (snapshot: WebpackBuildSnapshot | null) => void
}

function createBatch(refresh: boolean): BuildBatch {
  let resolve!: BuildBatch['resolve']
  const promise = new Promise<WebpackBuildSnapshot | null>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { refresh, promise, resolve }
}

function createWebpackBuildSession(options: {
  build: (isActive: () => boolean) => Promise<WebpackBuildSnapshot | null>
  previous?: Promise<void>
  onRefresh: () => void
  onError: (error: unknown) => void
}) {
  let active = true
  let snapshot: WebpackBuildSnapshot | null = null
  let current: BuildBatch | null = null
  let queued: BuildBatch | null = null
  let drain = Promise.resolve()
  let closePromise: Promise<void> | null = null
  const isActive = () => active
  const reportError = (error: unknown) => {
    if (active) {
      // A reporting failure must not leave build callers or shutdown waiting.
      try {
        options.onError(error)
      }
      catch {}
    }
  }
  const previous = options.previous ?? Promise.resolve()
  void previous.catch(reportError)

  const run = async () => {
    try {
      await previous
    }
    catch {
      current?.resolve(null)
      queued?.resolve(null)
      current = null
      queued = null
      return
    }
    while (current) {
      const batch = current
      let result: WebpackBuildSnapshot | null = null
      try {
        if (active) {
          result = await options.build(isActive)
          if (active && result) {
            snapshot = result
            if (batch.refresh) {
              options.onRefresh()
            }
          }
        }
      }
      catch (error) {
        reportError(error)
      }
      // Transfer ownership before resolving callers, so requests from promise
      // reactions always join a live batch or start a new drain.
      current = queued
      queued = null
      batch.resolve(active ? result : null)
    }
  }
  const request = (refresh: boolean) => {
    if (!active) {
      return Promise.resolve(null)
    }
    if (current) {
      if (!refresh) {
        return current.promise
      }
      queued ??= createBatch(true)
      return queued.promise
    }
    current = createBatch(refresh)
    const promise = current.promise
    drain = run()
    return promise
  }
  const close = () => {
    if (!closePromise) {
      active = false
      snapshot = null
      queued?.resolve(null)
      queued = null
      closePromise = Promise.all([previous, drain]).then(() => {})
    }
    return closePromise
  }

  return {
    isActive,
    peek: () => snapshot,
    ensureBuilt: () => request(false),
    refresh: () => request(true),
    close,
  }
}

type WebpackBuildSession = ReturnType<typeof createWebpackBuildSession>

export type { WebpackBuildSession, WebpackBuildSnapshot }
export { createWebpackBuildSession }
