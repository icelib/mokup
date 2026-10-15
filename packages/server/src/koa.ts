import type { NodeRequestLike } from './internal'
import type { ServerOptions } from './types'

import { Buffer } from 'node:buffer'
import { createRuntime } from '@mokup/runtime'
import { toRuntimeOptions } from './internal'
import { handleNodeRequest } from './internal/handle-request'
import { resolveResponseHeaders } from './internal/response-headers'

interface KoaContextLike {
  req: NodeRequestLike
  request?: {
    body?: unknown
    headers?: Record<string, string | string[] | undefined>
  }
  status?: number
  body?: unknown
  set: (header: Record<string, string>) => void
  /** Append a separate header field, required to preserve multiple Set-Cookie values. */
  append?: (name: string, value: string) => void
}

type KoaNext = () => Promise<unknown>

/**
 * Create a Koa middleware from server options.
 *
 * @param options - Server options.
 * @returns Koa middleware handler.
 *
 * @example
 * import { createKoaMiddleware } from '@mokup/server'
 *
 * const middleware = createKoaMiddleware({ manifest: { version: 1, routes: [] } })
 */
export function createKoaMiddleware(
  options: ServerOptions,
) {
  const runtime = createRuntime(toRuntimeOptions(options))
  const onNotFound = options.onNotFound ?? 'next'

  return async (ctx: KoaContextLike, next: KoaNext) => {
    const result = await handleNodeRequest(
      runtime,
      ctx.req,
      ctx.request?.body,
    )
    if (!result) {
      if (onNotFound === 'response') {
        ctx.body = null
        ctx.status = 404
        return
      }
      await next()
      return
    }
    ctx.body = result.body instanceof Uint8Array ? Buffer.from(result.body) : result.body
    ctx.status = result.status
    const { headers, setCookies } = ctx.append
      ? resolveResponseHeaders(result)
      : { headers: result.headers, setCookies: [] }
    ctx.set(headers)
    const [firstCookie, ...additionalCookies] = setCookies
    if (firstCookie !== undefined) {
      ctx.set({ 'set-cookie': firstCookie })
      for (const cookie of additionalCookies) {
        ctx.append?.('set-cookie', cookie)
      }
    }
  }
}
