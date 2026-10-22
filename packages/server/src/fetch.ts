import type { ControlledFetchHandler, FetchHandler, ServerOptions } from './types'

import { createRuntime } from '@mokup/runtime'
import { toRuntimeOptions } from './internal'
import { withRuntimeControls } from './internal/controls'

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
): ControlledFetchHandler {
  const runtime = createRuntime(toRuntimeOptions(options))
  const onNotFound = options.onNotFound ?? 'next'

  const handler: FetchHandler = async (request, context) => {
    const result = await runtime.fetch(request, context)
    if (!result) {
      if (onNotFound === 'response') {
        return new Response(null, { status: 404 })
      }
      return null
    }
    return result
  }
  return withRuntimeControls(handler, runtime)
}
