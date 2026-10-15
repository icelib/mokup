async function readBody(request: Request): Promise<Blob | null> {
  const { body, signal } = request
  if (!body) {
    signal.throwIfAborted()
    return null
  }
  const reader = body.getReader()
  let rejectAbort: (reason: unknown) => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => {
    rejectAbort(signal.reason)
    void reader.cancel(signal.reason).catch(() => {})
  }
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) {
    onAbort()
  }

  const collect = async () => {
    const chunks: ArrayBuffer[] = []
    while (true) {
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) {
        break
      }
      if (!ArrayBuffer.isView(value) || Object.prototype.toString.call(value) !== '[object Uint8Array]') {
        throw new TypeError('Request body stream must contain Uint8Array chunks')
      }
      chunks.push(new Uint8Array(value).buffer)
    }
    // Blob remains replayable across redirects on every supported Node runtime.
    return new Blob(chunks)
  }

  try {
    return await Promise.race([collect(), aborted])
  }
  catch (error) {
    if (!signal.aborted) {
      void reader.cancel(error).catch(() => {})
    }
    throw error
  }
  finally {
    signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

/** Rebuild a Request at a different URL with replayable bytes and its effective options. */
export async function toRewrittenRequestInit(request: Request, headers: Record<string, string>): Promise<RequestInit> {
  return {
    method: request.method,
    headers,
    body: await readBody(request),
    cache: request.cache,
    credentials: request.credentials,
    integrity: request.integrity,
    keepalive: request.keepalive,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  }
}
