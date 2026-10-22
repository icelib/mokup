import { copyResponseCookies } from './response-cookies'

/** Demand-driven replay without an unconsumed tee that prevents upstream cancellation. */
export function createResponseReplay(response: Response, onRelease: () => void = () => {}) {
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  const branches = new Set<object>()
  let done = !reader
  let failed = false
  let failure: unknown
  let pending: Promise<void> | undefined
  let closing: Promise<void> | undefined
  let retained = true
  const release = () => {
    if (!retained && branches.size === 0) {
      chunks.length = 0
      onRelease()
    }
  }

  const read = () => {
    pending ??= Promise.resolve().then(async () => {
      try {
        const next = await reader!.read()
        if (next.done) {
          done = true
          reader!.releaseLock()
        }
        else {
          chunks.push(new Uint8Array(next.value))
        }
      }
      catch (error) {
        failed = true
        failure = error
        reader!.releaseLock()
      }
    }).finally(() => { pending = undefined })
    return pending
  }

  const cancel = (reason: unknown) => {
    if (!closing && !done && !failed) {
      failed = true
      failure = reason ?? new DOMException('Response replay cancelled.', 'AbortError')
      closing = reader!.cancel(failure).finally(() => reader!.releaseLock())
    }
    return closing ?? Promise.resolve()
  }

  return {
    take(): Response {
      if (!reader) {
        return response.clone()
      }
      const branch = {}
      branches.add(branch)
      let index = 0
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (index >= chunks.length && !done && !failed) {
            await read()
          }
          if (!branches.has(branch)) {
            return
          }
          if (failed) {
            branches.delete(branch)
            controller.error(failure)
            release()
          }
          else if (index < chunks.length) {
            controller.enqueue(new Uint8Array(chunks[index++]!))
          }
          else if (done) {
            branches.delete(branch)
            controller.close()
            release()
          }
        },
        async cancel(reason) {
          branches.delete(branch)
          if (branches.size === 0) {
            await cancel(reason)
          }
          release()
        },
      }, { highWaterMark: 0 })
      return copyResponseCookies(response, new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }))
    },
    retire() {
      retained = false
      release()
    },
    async close() {
      await cancel(new DOMException('Response replay closed.', 'AbortError'))
      chunks.length = 0
      onRelease()
    },
  }
}
