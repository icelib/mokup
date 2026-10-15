type StreamListener = (...args: unknown[]) => void

/** Minimal readable stream contract, including optional Node stream state. */
export interface BodyReadableStream {
  on: (event: string, listener: StreamListener) => void
  off?: (event: string, listener: StreamListener) => void
  removeListener?: (event: string, listener: StreamListener) => void
  readableEnded?: boolean
  readableAborted?: boolean
  aborted?: boolean
  destroyed?: boolean
  closed?: boolean
  errored?: unknown
}

const encoder = new TextEncoder()

function prematureCloseError() {
  return Object.assign(new Error('Request body stream closed before ending'), {
    code: 'ERR_STREAM_PREMATURE_CLOSE',
  })
}

function removeListener(stream: BodyReadableStream, event: string, listener: StreamListener) {
  if (stream.off) {
    stream.off(event, listener)
  }
  else {
    stream.removeListener?.(event, listener)
  }
}

function guardQueuedError(stream: BodyReadableStream) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let target: BodyReadableStream | undefined = stream
  const cleanup = () => {
    if (!target) {
      return
    }
    const current = target
    target = undefined
    clearTimeout(timer)
    timer = undefined
    removeListener(current, 'error', cleanup)
    removeListener(current, 'close', cleanup)
  }
  const checkClosed = () => {
    if (target?.destroyed && target.closed === false) {
      timer = setTimeout(checkClosed, 10)
      timer.unref?.()
    }
    else {
      cleanup()
    }
  }
  // destroy(error) sets errored before emitting error, and autoDestroy starts
  // after end listeners run. Wait one turn, then guard only pending destruction.
  // Poll closed as a fallback for streams configured with emitClose: false.
  // On-only adapters cannot detach it, so cleanup makes their callback inert.
  stream.on('error', cleanup)
  if (target) {
    stream.on('close', cleanup)
    if (target) {
      timer = setTimeout(checkClosed, 0)
      timer.unref?.()
    }
  }
}

function mergeChunks(chunks: Uint8Array[]): Uint8Array | null {
  if (!chunks.length) {
    return null
  }
  if (chunks.length === 1) {
    return chunks[0] ?? null
  }
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/** Watch request failures during asynchronous work without consuming the body. */
export function withStreamLifecycle<T>(stream: BodyReadableStream, task: () => T | PromiseLike<T>): Promise<T> {
  let target: BodyReadableStream | undefined = stream
  let operation: (() => T | PromiseLike<T>) | undefined = task
  return new Promise((resolve, reject) => {
    const listeners = new Map<string, StreamListener>()
    let settled = false
    const cleanup = () => {
      const current = target
      target = undefined
      operation = undefined
      if (current) {
        for (const [event, listener] of listeners) {
          removeListener(current, event, listener)
        }
      }
      listeners.clear()
    }
    const fail = (error: unknown, queuedError = false) => {
      if (settled) {
        return
      }
      settled = true
      if (target && (queuedError || target.closed === false)) {
        guardQueuedError(target)
      }
      cleanup()
      reject(error)
    }
    const checkFailure = () => {
      const error = target?.errored ?? (!target?.readableEnded
        && (target?.destroyed || target?.closed || target?.aborted || target?.readableAborted)
        ? prematureCloseError()
        : null)
      if (error != null) {
        fail(error, true)
        return true
      }
      return false
    }
    const finish = (value: T) => {
      if (settled || checkFailure()) {
        return
      }
      settled = true
      if (target?.closed === false) {
        guardQueuedError(target)
      }
      cleanup()
      resolve(value)
    }
    const onClose = () => {
      if (!settled && !checkFailure() && !target?.readableEnded) {
        fail(prematureCloseError())
      }
    }
    const onAborted = () => {
      if (!settled && !target?.readableEnded) {
        fail(target?.errored ?? prematureCloseError(), true)
      }
    }
    try {
      for (const [event, listener] of [
        ['error', (error: unknown) => fail(error)],
        ['close', onClose],
        ['aborted', onAborted],
      ] as const) {
        if (settled) {
          break
        }
        listeners.set(event, listener)
        target?.on(event, listener)
      }
      if (!settled && !checkFailure() && operation) {
        const run = operation
        operation = undefined
        // Keep both handlers attached even if the stream settles first, so a
        // later task rejection never escapes as an unhandled rejection.
        void Promise.resolve(run()).then(finish, fail)
      }
    }
    catch (error) {
      fail(error)
    }
  })
}

/** Read the remaining body, or settle immediately if the stream has ended. */
export function readStreamBody(stream: BodyReadableStream): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    if (stream.errored != null) {
      guardQueuedError(stream)
      reject(stream.errored)
      return
    }
    if (stream.readableEnded) {
      if (stream.closed === false) {
        guardQueuedError(stream)
      }
      resolve(null)
      return
    }
    if (stream.destroyed || stream.aborted || stream.readableAborted) {
      guardQueuedError(stream)
      reject(prematureCloseError())
      return
    }

    const chunks: Uint8Array[] = []
    const listeners = new Map<string, StreamListener>()
    let settled = false
    const cleanup = () => {
      for (const [event, listener] of listeners) {
        removeListener(stream, event, listener)
      }
      listeners.clear()
      chunks.length = 0
    }
    const fail = (error: unknown) => {
      if (settled) {
        return
      }
      settled = true
      if (stream.closed === false) {
        guardQueuedError(stream)
      }
      cleanup()
      reject(error)
    }
    const finish = () => {
      if (settled) {
        return
      }
      try {
        const body = mergeChunks(chunks)
        settled = true
        if (stream.closed === false) {
          guardQueuedError(stream)
        }
        cleanup()
        resolve(body)
      }
      catch (error) {
        fail(error)
      }
    }
    const onData = (chunk: unknown) => {
      if (settled) {
        return
      }
      try {
        chunks.push(chunk instanceof Uint8Array
          ? chunk
          : chunk instanceof ArrayBuffer
            ? new Uint8Array(chunk)
            : encoder.encode(String(chunk)))
      }
      catch (error) {
        fail(error)
      }
    }
    const onClose = () => {
      if (stream.errored != null) {
        fail(stream.errored)
      }
      else if (stream.readableEnded) {
        finish()
      }
      else {
        fail(prematureCloseError())
      }
    }
    for (const [event, listener] of [
      ['error', fail],
      ['close', onClose],
      ['data', onData],
      ['end', finish],
    ] as const) {
      if (settled) {
        break
      }
      listeners.set(event, listener)
      stream.on(event, listener)
    }
    if (!settled) {
      if (stream.errored != null) {
        if (stream.closed !== false) {
          guardQueuedError(stream)
        }
        fail(stream.errored)
      }
      else if (stream.readableEnded) {
        finish()
      }
      else if (stream.destroyed || stream.aborted || stream.readableAborted) {
        if (stream.closed !== false) {
          guardQueuedError(stream)
        }
        onClose()
      }
    }
  })
}
