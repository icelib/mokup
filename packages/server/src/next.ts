import type { RuntimeControls, ServerOptions } from './types'

import { createConnectMiddleware } from './connect'
import { createFetchHandler } from './fetch'

/** Context passed by a Next.js App Router route handler. */
export interface NextRouteContext {
  params?: Record<string, string | string[]> | Promise<Record<string, string | string[]>>
  [key: string]: unknown
}

export type NextRouteHandler = (request: Request, context?: NextRouteContext) => Promise<Response>

export interface NextRouteHandlers extends RuntimeControls {
  GET: NextRouteHandler
  POST: NextRouteHandler
  PUT: NextRouteHandler
  PATCH: NextRouteHandler
  DELETE: NextRouteHandler
  HEAD: NextRouteHandler
  OPTIONS: NextRouteHandler
  CONNECT: NextRouteHandler
  TRACE: NextRouteHandler
}

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE'] as const

/**
 * Create a dependency-free Next.js App Router route module.
 *
 * The returned object can be exported directly from an App Router route file.
 * Export GET and POST (or any other method) from the returned object.
 * Route parameters and the complete Next context are available through the
 * shared resolver `context.context.next` value.
 */
export function createNextRouteHandler(options: ServerOptions): NextRouteHandlers {
  const handler = createFetchHandler({
    ...options,
    onNotFound: options.onNotFound ?? 'response',
  })
  const route = async (request: Request, context?: NextRouteContext) => {
    const response = await handler(request, {
      context: { framework: 'next', next: context },
    })
    return response ?? new Response(null, { status: 404 })
  }
  const routes = Object.fromEntries(methods.map(method => [method, route])) as Pick<NextRouteHandlers, typeof methods[number]>
  return Object.assign(routes, handler) as NextRouteHandlers
}

/** Structural subset of Next.js Pages Router request/response objects. */
export interface NextApiRequestLike {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
  [key: string]: unknown
}

export interface NextApiResponseLike {
  statusCode?: number
  setHeader?: (name: string, value: string | string[]) => void
  end?: (body?: unknown) => void
  write?: (chunk: unknown) => void
  [key: string]: unknown
}

/**
 * Adapt the Node-based Pages Router API route shape. The returned function is
 * intentionally structural and does not require `next` or `next/server` as a
 * dependency, so it is also usable in tests and custom Next runtimes.
 */
export function createNextApiHandler(options: ServerOptions) {
  const middleware = createConnectMiddleware({
    ...options,
    onNotFound: options.onNotFound ?? 'response',
  })
  const handler = async (request: NextApiRequestLike, response: NextApiResponseLike) => {
    await middleware(request as never, response as never, (error?: unknown) => {
      if (error) {
        throw error
      }
    })
  }
  return Object.assign(handler, middleware) as typeof handler & RuntimeControls
}
