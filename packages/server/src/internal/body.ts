import type { ReadableStreamLike } from './types'
import { readStreamBody } from '@mokup/shared/stream-body'

const textDecoder = new TextDecoder()

interface ResolvedRequestBody {
  body: unknown
  rawBody?: string
  rawBodyBytes?: Uint8Array
}

/**
 * Parse raw body text based on content type.
 *
 * @param rawText - Raw body text.
 * @param contentType - Content type string.
 * @returns Parsed body value.
 *
 * @example
 * import { parseBody } from '@mokup/server'
 *
 * const body = parseBody('{\"ok\":true}', 'application/json')
 */
export function parseBody(rawText: string, contentType: string) {
  if (!rawText) {
    return undefined
  }
  if (contentType === 'application/json' || contentType.endsWith('+json')) {
    try {
      return JSON.parse(rawText)
    }
    catch {
      return rawText
    }
  }
  if (contentType === 'application/x-www-form-urlencoded') {
    const params = new URLSearchParams(rawText)
    return Object.fromEntries(params.entries())
  }
  return rawText
}

function resolveByteBody(data: Uint8Array, contentType: string): ResolvedRequestBody {
  // Snapshot only this view before asynchronous runtime work can observe mutations.
  const rawBodyBytes = new Uint8Array(data)
  const rawBody = textDecoder.decode(rawBodyBytes)
  return { body: parseBody(rawBody, contentType), rawBody, rawBodyBytes }
}

/**
 * Normalize a binary body for runtime output.
 *
 * @param body - Binary data.
 * @returns Binary data.
 *
 * @example
 * import { toBinaryBody } from '@mokup/server'
 *
 * const data = toBinaryBody(new Uint8Array([1, 2]))
 */
export function toBinaryBody(body: Uint8Array): Uint8Array {
  return body
}

/**
 * Convert a Uint8Array to an ArrayBuffer.
 *
 * @param body - Binary data.
 * @returns ArrayBuffer view of the data.
 *
 * @example
 * import { toArrayBuffer } from '@mokup/server'
 *
 * const buffer = toArrayBuffer(new Uint8Array([1, 2]))
 */
export function toArrayBuffer(body: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = body
  if (
    buffer instanceof ArrayBuffer
    && byteOffset === 0
    && byteLength === buffer.byteLength
  ) {
    return buffer
  }
  const copy = new Uint8Array(byteLength)
  copy.set(body)
  return copy.buffer
}

async function resolveBody(
  body: unknown,
  contentType: string,
  stream?: ReadableStreamLike,
): Promise<ResolvedRequestBody> {
  if (typeof body !== 'undefined') {
    if (typeof body === 'string') {
      return {
        body: parseBody(body, contentType),
        rawBody: body,
      }
    }
    if (body instanceof Uint8Array) {
      return resolveByteBody(body, contentType)
    }
    if (body instanceof ArrayBuffer) {
      return resolveByteBody(new Uint8Array(body), contentType)
    }
    return {
      body,
    }
  }

  if (!stream) {
    return { body: undefined }
  }

  const rawBytes = await readStreamBody(stream)
  if (!rawBytes) {
    return { body: undefined }
  }
  if (rawBytes.length === 0) {
    return { body: undefined, rawBodyBytes: new Uint8Array(0) }
  }
  return resolveByteBody(rawBytes, contentType)
}

export { resolveBody, type ResolvedRequestBody }
