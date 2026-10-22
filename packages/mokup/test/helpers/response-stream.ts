import { Buffer } from 'node:buffer'
import { Writable } from 'node:stream'
import { vi } from 'vitest'

/** Keep test-specific HTTP fields while providing a real Writable lifecycle. */
export function createResponseStream<T extends object>(response: T): Writable & T {
  const chunks: Buffer[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
  const descriptors = Object.getOwnPropertyDescriptors(response)
  const originalEnd = 'end' in response && typeof response.end === 'function' ? response.end : undefined
  delete descriptors['end']
  Object.defineProperties(stream, descriptors)
  const end = stream.end.bind(stream)
  stream.end = vi.fn((chunk?: string | Uint8Array, encoding?: BufferEncoding, callback?: () => void) => {
    const body = chunks.length
      ? Buffer.concat([...chunks, ...(chunk === undefined ? [] : [Buffer.from(chunk)])])
      : chunk
    originalEnd?.(body)
    return end(chunk, encoding, callback)
  }) as Writable['end']
  return stream as Writable & T
}
