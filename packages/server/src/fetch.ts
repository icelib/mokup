import type { FetchHandler, ServerOptions } from './types'

import { createRuntime } from '@mokup/runtime'
import { toArrayBuffer, toRuntimeOptions } from './internal'
import { handleFetchRequest } from './internal/handle-request'
import { resolveResponseHeaders } from './internal/response-headers'

/**
 * Create a fetch handler that executes mokup routes.
 *
 * @param options - Server options.
 * @returns Fetch handler for use in adapters.
 *
 * @example
 * import { createFetchHandler } from '@mokup/server/fetch'
 *
 * const handler = createFetchHandler({ manifest: { version: 1, routes: [] } })
 */
export function createFetchHandler(
  options: ServerOptions,
): FetchHandler {
  const runtime = createRuntime(toRuntimeOptions(options))
  const onNotFound = options.onNotFound ?? 'next'

  return async (request) => {
    const result = await handleFetchRequest(runtime, request)
    if (!result) {
      if (onNotFound === 'response') {
        return new Response(null, { status: 404 })
      }
      return null
    }
    const responseBody = result.body === null
      ? null
      : typeof result.body === 'string'
        ? result.body
        : toArrayBuffer(result.body)
    const { headers: scalarHeaders, setCookies } = resolveResponseHeaders(result)
    const headers = new Headers(scalarHeaders)
    for (const cookie of setCookies) {
      headers.append('set-cookie', cookie)
    }
    return new Response(responseBody, {
      status: result.status,
      headers,
    })
  }
}
