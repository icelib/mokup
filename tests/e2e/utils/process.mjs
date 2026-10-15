/** @type {WeakMap<import('node:child_process').ChildProcess, Promise<void>>} */
const pendingStops = new WeakMap()

/** @param {import('node:child_process').ChildProcess} child */
function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

/**
 * Stop an owned process, waiting for actual exit before completing cleanup.
 * @param {import('node:child_process').ChildProcess | undefined} child
 * @param {{ graceMs?: number, forceMs?: number }} options
 * @returns {Promise<void>}
 */
export function stopProcess(child, { graceMs = 5_000, forceMs = 5_000 } = {}) {
  if (!child || !child.pid || hasExited(child)) {
    return Promise.resolve()
  }
  const existing = pendingStops.get(child)
  if (existing) {
    return existing
  }

  /** @type {Promise<void>} */
  const stopped = new Promise((resolve, reject) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let graceTimer
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let forceTimer
    let settled = false

    /** @param {Error} [error] */
    function finish(error) {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(graceTimer)
      clearTimeout(forceTimer)
      child.off('exit', onExit)
      child.off('error', onError)
      if (error) {
        reject(error)
      }
      else {
        resolve()
      }
    }

    function onExit() {
      finish()
    }

    /** @param {Error} error */
    function onError(error) {
      finish(error)
    }

    /** @param {NodeJS.Signals} signal */
    function signalProcess(signal) {
      if (hasExited(child)) {
        finish()
        return
      }
      try {
        if (!child.kill(signal)) {
          finish(new Error(`Failed to send ${signal} to process ${child.pid}`))
        }
      }
      catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }

    child.once('exit', onExit)
    child.once('error', onError)
    graceTimer = setTimeout(() => {
      forceTimer = setTimeout(() => {
        finish(new Error(`Process ${child.pid} did not exit within ${forceMs}ms after SIGKILL`))
      }, forceMs)
      signalProcess('SIGKILL')
    }, graceMs)
    signalProcess('SIGTERM')
  })
  pendingStops.set(child, stopped)
  const clearPending = () => pendingStops.delete(child)
  void stopped.then(clearPending, clearPending)
  return stopped
}
