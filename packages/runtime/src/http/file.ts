import type { HttpParams, HttpParamValue, HttpResolver } from './types'

/** Serializable file metadata. Resolver and iterator state are never serialized. */
export interface HttpRouteOptions {
  enabled?: boolean
  once?: boolean
  status?: number
  headers?: Record<string, string>
  delay?: number
}

export interface HttpRouteRule extends HttpRouteOptions {
  handlerType: 'http'
  handler: HttpResolver
}

/** Define a native Fetch resolver whose method and URL come from its filename. */
export function defineHttpHandler<Params extends Record<keyof Params, HttpParamValue> = HttpParams, RequestBody = never, ResponseBody = never>(handler: HttpResolver<Params, RequestBody, NoInfer<ResponseBody>>, options: HttpRouteOptions = {}): HttpRouteRule {
  return { ...options, handlerType: 'http', handler: handler as unknown as HttpResolver }
}
