import type { HttpCleanup } from './types'
import { copyResponseCookies } from './response-cookies'

export function withAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let abort: () => void
    const settle = <V>(callback: (value: V) => void, value: V) => {
      signal.removeEventListener('abort', abort)
      callback(value)
    }
    abort = () => settle(reject, signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
    }
    work.then(value => settle(resolve, value), error => settle(reject, error))
  })
}

export function createRequestResources(signal: AbortSignal, release: (cleanup: HttpCleanup) => void) {
  const callbacks: HttpCleanup[] = []
  let finishing: Promise<void> | undefined
  let onAbort: () => void
  const finish = () => {
    if (!finishing) {
      signal.removeEventListener('abort', onAbort)
      finishing = Promise.resolve().then(async () => {
        const results = await Promise.allSettled(callbacks.splice(0).map(callback => Promise.resolve().then(callback)))
        release(finish)
        const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
        if (errors.length) {
          throw new AggregateError(errors, 'HTTP mock cleanup failed.')
        }
      })
    }
    return finishing
  }
  onAbort = () => {
    void finish().catch(() => undefined)
  }
  signal.addEventListener('abort', onAbort, { once: true })

  return {
    finish,
    finalize(callback: HttpCleanup) {
      if (finishing) {
        // A resolver may finish after cancellation; still release late resources.
        void Promise.resolve().then(callback).catch(() => undefined)
      }
      else {
        callbacks.push(callback)
      }
    },
    async observe(response: Response): Promise<Response> {
      if (!response.body) {
        await finish()
        return response
      }
      const reader = response.body.getReader()
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
      let cancellation: Promise<void> | undefined
      const abort = () => {
        streamController?.error(signal.reason)
        cancellation ??= reader.cancel(signal.reason)
        void cancellation.catch(() => undefined)
      }
      signal.addEventListener('abort', abort, { once: true })
      callbacks.push(async () => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) {
          abort()
        }
        await cancellation
      })
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          if (signal.aborted) {
            abort()
          }
        },
        async pull(controller) {
          try {
            const next = await reader.read()
            if (next.done) {
              await finish()
              controller.close()
            }
            else {
              controller.enqueue(next.value)
            }
          }
          catch (error) {
            controller.error(error)
            await finish()
          }
        },
        async cancel(reason) {
          try {
            cancellation ??= reader.cancel(reason)
            await cancellation
          }
          finally {
            await finish()
          }
        },
      })
      return copyResponseCookies(response, new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }))
    },
  }
}
