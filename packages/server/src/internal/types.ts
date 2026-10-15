import type { BodyReadableStream } from '@mokup/shared/stream-body'

/**
 * Minimal readable stream shape used by adapters.
 *
 * @example
 * import type { ReadableStreamLike } from '@mokup/server'
 *
 * const stream: ReadableStreamLike = {
 *   on: () => {},
 * }
 */
export interface ReadableStreamLike extends BodyReadableStream {}

/**
 * Minimal Node request shape used by adapters.
 *
 * @example
 * import type { NodeRequestLike } from '@mokup/server'
 *
 * const req: NodeRequestLike = { method: 'GET', url: '/api/ping' }
 */
export interface NodeRequestLike extends ReadableStreamLike {
  method?: string | undefined
  url?: string | undefined
  originalUrl?: string | undefined
  headers?: Record<string, string | string[] | undefined> | undefined
  body?: unknown
}

/**
 * Minimal Node response shape used by adapters.
 *
 * @example
 * import type { NodeResponseLike } from '@mokup/server'
 *
 * const res: NodeResponseLike = {
 *   setHeader: () => {},
 *   end: () => {},
 * }
 */
export interface NodeResponseLike {
  statusCode?: number
  setHeader: (name: string, value: string) => void
  /** Append a separate header field, required to preserve multiple Set-Cookie values. */
  appendHeader?: (name: string, value: string) => void
  end: (data?: string | Uint8Array | ArrayBuffer | null) => void
}
