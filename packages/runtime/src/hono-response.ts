import type { Context, Hono } from '@mokup/shared/hono'
import { copyResponseCookies } from './http/response-cookies'

const bridges = new WeakMap<Pick<Hono, 'fetch'>, (app: Pick<Hono, 'fetch'>) => void>()

/** Copied Hono routes must share their response metadata bridge with the mounting app. */
export function inheritHonoResponseBridge(source: Pick<Hono, 'fetch'>, mounted: Pick<Hono, 'fetch'>) {
  bridges.get(source)?.(mounted)
}

/** Retain hidden Set-Cookie metadata after Hono merges an existing context response. */
export function preserveHonoResponse(context: Context, response: Response): Response {
  if (response.type === 'error') {
    return response
  }
  context.res = response
  return copyResponseCookies(response, context.res, context.res.headers)
}

/** Bridge response reconstruction performed by Hono after route middleware, including HEAD. */
export function createHonoResponseBridge(app: Pick<Hono, 'fetch'>): (context: Context, response: Response) => Response {
  const responses = new WeakMap<Request, Response>()
  const install = (target: Pick<Hono, 'fetch'>) => {
    const activeRequests = new WeakSet<Request>()
    const fetch = target.fetch
    target.fetch = async (request, ...args) => {
      // Concurrent reuse of a Request needs a distinct context key. Ordinary
      // requests keep their identity and do not incur another upload-body tee.
      const ownedRequest = activeRequests.has(request) ? request.clone() : request
      activeRequests.add(ownedRequest)
      try {
        const response = await fetch(ownedRequest, ...args)
        const original = responses.get(ownedRequest)
        return original?.type === 'error' ? original : original ? copyResponseCookies(original, response) : response
      }
      finally {
        responses.delete(ownedRequest)
        activeRequests.delete(ownedRequest)
      }
    }
  }
  bridges.set(app, install)
  install(app)
  return (context, response) => {
    responses.set(context.req.raw, response)
    return response
  }
}
