import type { createRuntime } from '@mokup/runtime'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { sendNodeResponse, toSessionRequest } from '@mokup/core/middleware'
import { withStreamLifecycle } from '@mokup/shared/stream-body'
import { normalizeNodeHeaders } from './normalize'
import { resolveNodeRequestUrl } from './request-url'

/** Replay upload copies for fallthrough, and keep response streaming in the shared session. */
export async function dispatchNodeSession(
  runtime: ReturnType<typeof createRuntime>,
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
  bodyOverride?: unknown,
  onMocked?: () => void,
): Promise<boolean> {
  // Validate before loading the manifest or attaching request listeners.
  const url = resolveNodeRequestUrl(req.url ?? '/', normalizeNodeHeaders(req.headers))
  if (req.url?.startsWith('/') && 'encrypted' in req.socket && req.socket.encrypted) {
    url.protocol = 'https:'
  }
  const session = await withStreamLifecycle(req, runtime.ready)
  const controller = new AbortController()
  const aborted = () => {
    queueMicrotask(() => controller.abort(req.errored ?? new DOMException('Mock client disconnected.', 'AbortError')))
  }
  const failed = (error: Error) => controller.abort(error)
  const closed = () => {
    if (!res.writableFinished) {
      aborted()
    }
  }
  req.on('aborted', aborted)
  req.on('error', failed)
  res.on('close', closed)
  let ownsResponse = false
  try {
    const signal = AbortSignal.any([controller.signal, session.signal])
    const request = await toSessionRequest(req, url, signal, bodyOverride === undefined ? req.body : bodyOverride)
    const response = await session.handle(request)
    if (!response) {
      return false
    }
    ownsResponse = true
    req.resume()
    onMocked?.()
    if (response.type === 'error') {
      res.destroy()
    }
    else {
      await sendNodeResponse(res, response)
    }
    return true
  }
  catch (error) {
    if (ownsResponse) {
      // A committed or hijacked response belongs to this transport. Terminate
      // it on stream failure instead of invoking another framework response.
      res.destroy()
      return true
    }
    throw error
  }
  finally {
    req.off('aborted', aborted)
    req.off('error', failed)
    res.off('close', closed)
  }
}
