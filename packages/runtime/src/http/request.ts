/** A nonempty RequestInit resets referrer metadata unless it is copied explicitly. */
import type { HttpRequestContext } from './types'
import { withAbort } from './resources'

export function withRequestSignal(request: Request, signal: AbortSignal): Request {
  return new Request(request, {
    signal,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
  })
}

export function createLazyRequest(request: Request, context: HttpRequestContext, signal: AbortSignal) {
  let loaded: Promise<Request> | undefined
  return () => {
    loaded ??= context.loadRequest
      ? withAbort(Promise.resolve().then(() => context.loadRequest!(signal)), signal).then((input) => {
          if (input.url !== request.url || input.method !== request.method) {
            throw new TypeError('A lazy request body must preserve the request URL and method.')
          }
          return input
        })
      : Promise.resolve(request)
    return loaded
  }
}
