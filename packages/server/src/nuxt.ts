import type { RuntimeControls, ServerOptions } from './types'

import { createConnectMiddleware } from './connect'
import { createFetchHandler } from './fetch'

/** Minimal Nuxt/Nitro event shape required by the adapter. */
export interface NuxtEventLike {
  request?: Request
  node?: {
    req: unknown
    res: unknown
  }
  context?: unknown
  [key: string]: unknown
}

export type NuxtEventHandler = (event: NuxtEventLike) => Promise<Response | void>

function isFetchRequest(value: unknown): value is Request {
  return value instanceof Request || Boolean(value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string')
}

/**
 * Create a Nuxt/Nitro server handler.
 *
 * Modern Nitro events expose a Fetch `event.request`; older Node deployments
 * expose `event.node.req/res`. Both paths use the same Mokup runtime and
 * controls. The adapter has no Nuxt or H3 dependency.
 */
export function createNuxtHandler(options: ServerOptions): NuxtEventHandler & RuntimeControls {
  const fetchHandler = createFetchHandler({
    ...options,
    onNotFound: options.onNotFound ?? 'response',
  })
  const nodeMiddleware = createConnectMiddleware({
    ...options,
    onNotFound: options.onNotFound ?? 'response',
  })
  const handler: NuxtEventHandler = async (event) => {
    if (isFetchRequest(event.request)) {
      const response = await fetchHandler(event.request, {
        context: { framework: 'nuxt', nuxt: event, eventContext: event.context },
      })
      return response ?? new Response(null, { status: 404 })
    }
    if (event.node?.req && event.node.res) {
      await nodeMiddleware(event.node.req as never, event.node.res as never, (error?: unknown) => {
        if (error) {
          throw error
        }
      })
      return
    }
    throw new TypeError('Nuxt mock handler requires event.request or event.node.req/res.')
  }
  return Object.assign(handler, fetchHandler) as NuxtEventHandler & RuntimeControls
}
