import type { RuntimeControls, ServerOptions } from './types'

import { createFetchHandler } from './fetch'

/** Structural subset of Astro's API endpoint context. */
export interface AstroEndpointContextLike {
  request: Request
  params?: Record<string, string | undefined>
  locals?: unknown
  [key: string]: unknown
}

export type AstroEndpointHandler = (context: AstroEndpointContextLike) => Promise<Response>

export interface AstroEndpointHandlers extends RuntimeControls {
  GET: AstroEndpointHandler
  POST: AstroEndpointHandler
  PUT: AstroEndpointHandler
  PATCH: AstroEndpointHandler
  DELETE: AstroEndpointHandler
  HEAD: AstroEndpointHandler
  OPTIONS: AstroEndpointHandler
  CONNECT: AstroEndpointHandler
  TRACE: AstroEndpointHandler
}

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'] as const

/**
 * Create an Astro endpoint module with one handler per HTTP method.
 *
 * The original Astro context is available through `context.context.astro` in
 * Mokup resolvers, while the request remains a standard Fetch Request.
 */
export function createAstroEndpoint(options: ServerOptions): AstroEndpointHandlers {
  const handler = createFetchHandler({
    ...options,
    onNotFound: options.onNotFound ?? 'response',
  })
  const endpoint = async (context: AstroEndpointContextLike) => {
    const response = await handler(context.request, {
      context: { framework: 'astro', astro: context },
    })
    return response ?? new Response(null, { status: 404 })
  }
  const routes = Object.fromEntries(methods.map(method => [method, endpoint])) as Pick<AstroEndpointHandlers, typeof methods[number]>
  return Object.assign(routes, handler) as AstroEndpointHandlers
}
