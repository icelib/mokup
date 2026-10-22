export function playwrightBodyLimits(maxBodyBytes = 1024 * 1024, bodyTimeoutMs = 5000) {
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 0
    || !Number.isFinite(bodyTimeoutMs) || bodyTimeoutMs <= 0 || bodyTimeoutMs > 2147483647) {
    throw new RangeError('Playwright body limits require a nonnegative integer size and positive finite timeout.')
  }
  return { maxBodyBytes, bodyTimeoutMs }
}

/** Playwright fulfill requires a finite body, so infinite response streams fail explicitly. */
export async function readPlaywrightBody(response: Response, maxBodyBytes: number, bodyTimeoutMs: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) {
    return new Uint8Array()
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Playwright mock response exceeded ${bodyTimeoutMs} ms; infinite streams cannot be fulfilled.`)), bodyTimeoutMs)
  })
  try {
    while (true) {
      const next = await Promise.race([reader.read(), timeout])
      if (next.done) {
        const result = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) {
          result.set(chunk, offset)
          offset += chunk.byteLength
        }
        return result
      }
      length += next.value.byteLength
      if (length > maxBodyBytes) {
        throw new RangeError(`Playwright mock response exceeds ${maxBodyBytes} bytes.`)
      }
      chunks.push(next.value.slice())
    }
  }
  catch (error) {
    void reader.cancel(error).catch(() => undefined)
    throw error
  }
  finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}
