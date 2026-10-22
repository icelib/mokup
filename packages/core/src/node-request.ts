import type { IncomingMessage } from 'node:http'
import { Buffer } from 'node:buffer'

/** Read a copy and restore it before EOF can be emitted to downstream middleware. */
export function readReplayableBody(req: IncomingMessage, signal: AbortSignal): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    let read: () => void
    let fail: (error: unknown) => void
    let aborted: () => void
    let closed: () => void
    function cleanup() {
      req.off('readable', read)
      req.off('error', fail)
      req.off('aborted', aborted)
      req.off('close', closed)
      signal.removeEventListener('abort', aborted)
    }
    fail = (error: unknown) => {
      if (!settled) {
        settled = true
        cleanup()
        reject(error)
      }
    }
    aborted = () => {
      // IncomingMessage emits aborted before destroy(error) publishes errored.
      // Keep the error listener until that queued failure can be observed.
      queueMicrotask(() => fail(req.errored ?? signal.reason ?? new DOMException('Mock request aborted.', 'AbortError')))
    }
    closed = () => {
      if (!req.complete) {
        aborted()
      }
    }
    read = () => {
      if (settled) {
        return
      }
      try {
        // read() schedules 'end' for a later turn. Restore synchronously before
        // that turn, using public stream methods and the HTTP parser's EOF flag.
        while (true) {
          const chunk = req.read() as Buffer | string | null
          if (chunk === null) {
            break
          }
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        if (req.complete) {
          const body = chunks.length ? Buffer.concat(chunks) : null
          if (body) {
            req.unshift(body)
          }
          settled = true
          cleanup()
          resolve(body)
        }
      }
      catch (error) {
        fail(error)
      }
    }
    if (signal.aborted || req.aborted) {
      aborted()
      return
    }
    if (req.readableEnded) {
      resolve(null)
      return
    }
    req.on('readable', read)
    req.on('error', fail)
    req.on('aborted', aborted)
    req.on('close', closed)
    signal.addEventListener('abort', aborted, { once: true })
    read()
  })
}

export async function toSessionRequest(req: IncomingMessage, url: URL, signal: AbortSignal, bodyOverride?: unknown): Promise<Request> {
  const method = req.method ?? 'GET'
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(',') : value)
    }
  }
  const init: RequestInit = { method, headers, signal }
  if (method !== 'GET' && method !== 'HEAD') {
    const body = bodyOverride === undefined
      ? await readReplayableBody(req, signal)
      : typeof bodyOverride === 'string' || bodyOverride instanceof Uint8Array || bodyOverride instanceof ArrayBuffer
        ? bodyOverride
        : JSON.stringify(bodyOverride)
    if (body !== null && body !== undefined) {
      init.body = body as BodyInit
    }
  }
  return new Request(url, init)
}
