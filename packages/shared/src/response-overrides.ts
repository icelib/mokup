import type { Context } from 'hono'

interface ResponseOverrides {
  status?: number
  headers?: Record<string, string>
}

function isValidStatus(status: unknown): status is number {
  return typeof status === 'number'
    && Number.isFinite(status)
    && status >= 200
    && status <= 599
}

/** Apply route overrides while preserving Fetch's null-body status contract. */
export function applyResponseOverrides(response: Response, overrides: ResponseOverrides, method?: string): Response {
  const headers = new Headers(response.headers)
  let changedHeaders = !!overrides.headers && Object.keys(overrides.headers).length > 0
  for (const [key, value] of Object.entries(overrides.headers ?? {})) {
    headers.set(key, value)
  }
  const status = isValidStatus(overrides.status)
    ? overrides.status
    : isValidStatus(response.status) ? response.status : 200
  const bodyless = method === 'HEAD' || status === 204 || status === 205 || status === 304

  // 304 may describe the selected representation's length/transfer coding.
  // 204 and 205 must not advertise the discarded payload's framing instead.
  if (status === 204 || status === 205) {
    for (const name of ['content-length', 'transfer-encoding']) {
      if (headers.has(name)) {
        headers.delete(name)
        changedHeaders = true
      }
    }
  }
  if (status === response.status && !changedHeaders && !(bodyless && response.body)) {
    return response
  }
  if (bodyless && response.body) {
    // The discarded stream may own a producer or socket. Cancellation failures
    // cannot supply a payload for these statuses and must not escape unhandled.
    void response.body.cancel().catch(() => undefined)
  }
  return new Response(bodyless ? null : response.body, { status, headers })
}

/** Replace a finalized Hono response without restoring its old header values. */
export function applyContextResponseOverrides(context: Context, response: Response, overrides: ResponseOverrides): Response {
  const overridden = applyResponseOverrides(response, overrides, context.req.method)
  const headers = new Headers(overridden.headers)
  context.res = overridden
  // Hono's setter merges old context headers into a replacement response. Use
  // its public header API to make the finalized response authoritative instead.
  for (const name of Array.from(context.res.headers.keys())) {
    if (!headers.has(name)) {
      context.header(name, undefined)
    }
  }
  for (const [name, value] of headers) {
    if (name !== 'set-cookie') {
      context.header(name, value)
    }
  }
  if (headers.has('set-cookie')) {
    context.header('set-cookie', undefined)
    for (const cookie of headers.getSetCookie()) {
      context.header('set-cookie', cookie, { append: true })
    }
  }
  return context.res
}
