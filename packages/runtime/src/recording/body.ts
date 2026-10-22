import type { RecordedBody, RecordingOptions } from './types'

export function bodyLimits(options: Pick<RecordingOptions, 'maxBodyBytes' | 'bodyTimeoutMs'>) {
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 5000
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 0
    || !Number.isFinite(bodyTimeoutMs) || bodyTimeoutMs <= 0 || bodyTimeoutMs > 2147483647) {
    throw new RangeError('Recording requires a nonnegative integer body limit and a positive finite timeout.')
  }
  return { maxBodyBytes, bodyTimeoutMs }
}

export function encodeBody(bytes: Uint8Array | null): RecordedBody | null {
  if (bytes === null) {
    return null
  }
  const parts: string[] = []
  for (let index = 0; index < bytes.length; index += 8192) {
    parts.push(String.fromCharCode(...bytes.subarray(index, index + 8192)))
  }
  return { encoding: 'base64', data: btoa(parts.join('')) }
}

export function decodeBody(body: RecordedBody | null): Uint8Array<ArrayBuffer> | null {
  if (body === null) {
    return null
  }
  if (body.encoding !== 'base64') {
    throw new TypeError('Recorded bodies must use base64 encoding.')
  }
  const binary = atob(body.data)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

/** Consumes only a caller-owned clone; cancellation never waits for the original tee branch. */
export async function readBody(source: Request | Response, options: Pick<RecordingOptions, 'maxBodyBytes' | 'bodyTimeoutMs'>, cancellation?: AbortSignal) {
  const { maxBodyBytes, bodyTimeoutMs } = bodyLimits(options)
  const sourceSignal = 'signal' in source ? source.signal : undefined
  const signal = sourceSignal && cancellation ? AbortSignal.any([sourceSignal, cancellation]) : sourceSignal ?? cancellation
  signal?.throwIfAborted()
  if (source.bodyUsed || source.body?.locked) {
    throw new TypeError('Recording requires an unused, unlocked body.')
  }
  if (!source.body) {
    return null
  }
  const clone = source.clone()
  const reader = clone.body!.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Recording body exceeded ${bodyTimeoutMs} ms; only finite bodies are supported.`)), bodyTimeoutMs)
    onAbort = () => reject(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout])
      if (done) {
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.length
        }
        return bytes
      }
      size += value.byteLength
      if (size > maxBodyBytes) {
        throw new RangeError(`Recording body exceeds ${maxBodyBytes} bytes.`)
      }
      chunks.push(value.slice())
    }
  }
  catch (error) {
    void reader.cancel(error).catch(() => undefined)
    throw error
  }
  finally {
    clearTimeout(timer)
    if (onAbort) {
      signal?.removeEventListener('abort', onAbort)
    }
    reader.releaseLock()
  }
}
