import type { HttpHandler, HttpHandlerOptions, HttpMatcher, HttpParams, HttpParamValue, HttpResolver } from './types'

function method(name: string) {
  return <Params extends Record<keyof Params, HttpParamValue> = HttpParams, RequestBody = never, ResponseBody = never>(matcher: HttpMatcher, resolver: HttpResolver<Params, RequestBody, NoInfer<ResponseBody>>, options: HttpHandlerOptions = {}): HttpHandler => {
    // Definitions erase compile-time body contracts; the session executes standard Fetch objects.
    return Object.freeze({ method: name, matcher, resolver: resolver as unknown as HttpResolver, once: options.once ?? false })
  }
}

/** Define HTTP mocks without choosing a server, browser, or build tool. */
export const http = {
  get: method('GET'),
  post: method('POST'),
  put: method('PUT'),
  patch: method('PATCH'),
  delete: method('DELETE'),
  head: method('HEAD'),
  options: method('OPTIONS'),
  all: method('*'),
}
