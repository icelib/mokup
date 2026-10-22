import type {
  HttpCookies,
  HttpHandler,
  PassthroughResult,
  StrictResponse,
  TypedRequest,
} from 'mokup/http'

/** Runtime method names exposed by MSW's HTTP facade. */
export const HttpMethods = Object.freeze({
  HEAD: 'HEAD',
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  OPTIONS: 'OPTIONS',
  DELETE: 'DELETE',
})

export type MaybePromise<Value> = Value | Promise<Value>
export type Path = string | RegExp
export type PathParams<Key extends PropertyKey = string> = Record<Extract<Key, string>, string | string[]>
export interface Match {
  readonly matches: boolean
  readonly params: PathParams
}

export type HttpHandlerMethod = string | RegExp
export interface HttpHandlerInfo {
  readonly header?: string
  readonly method: HttpHandlerMethod
  readonly path: HttpRequestPredicate
}
export interface RequestQuery {
  readonly [queryName: string]: string
}
export interface HttpRequestParsedResult {
  readonly match: Match
  readonly cookies: Record<string, string>
}
export interface HttpRequestResolverExtras<Params extends PathParams = PathParams> extends Record<string, unknown> {
  params: Params
  cookies: HttpCookies
}
export type HttpCustomPredicateResult<Params extends PathParams = PathParams> = boolean | {
  matches: boolean
  params: Params
}
export type HttpCustomPredicate<Params extends PathParams = PathParams> = (args: {
  request: Request
  cookies: Record<string, string>
}) => HttpCustomPredicateResult<Params> | Promise<HttpCustomPredicateResult<Params>>
export type HttpRequestPredicate<Params extends PathParams = PathParams> = Path | HttpCustomPredicate<Params>
export type HttpRequestHandler = <
  Params extends PathParams<keyof Params> = PathParams,
  RequestBodyType extends DefaultBodyType = DefaultBodyType,
  ResponseBodyType extends DefaultBodyType = undefined,
>(
  predicate: HttpRequestPredicate<Params>,
  resolver: HttpResponseResolver<Params, RequestBodyType, ResponseBodyType>,
  options?: RequestHandlerOptions,
) => HttpHandler
export type HttpResponseResolver<
  Params extends PathParams<keyof Params> = PathParams,
  RequestBodyType extends DefaultBodyType = DefaultBodyType,
  ResponseBodyType extends DefaultBodyType = DefaultBodyType,
> = ResponseResolver<HttpRequestResolverExtras<Params>, RequestBodyType, ResponseBodyType>
export interface RequestHandlerOptions {
  once?: boolean
}

export type DefaultRequestMultipartBody = Record<string, string | File | Array<string | File>>
export type DefaultBodyType = Record<string, any> | DefaultRequestMultipartBody | string | number | boolean | null | undefined
export type JsonBodyType = Record<string, any> | string | number | boolean | null | undefined
export type ResponseType = 'basic' | 'cors' | 'default' | 'error' | 'opaque' | 'opaqueredirect'
export type HttpResponseInit = ResponseInit & { type?: ResponseType }

export type StrictRequest<BodyType extends JsonBodyType = JsonBodyType> = TypedRequest<BodyType>
declare const responseBodyType: unique symbol
export type DefaultUnsafeFetchResponse = Response & { readonly [responseBodyType]?: never }
export type ResponseResolverReturnType<ResponseBodyType extends DefaultBodyType = undefined>
  = [ResponseBodyType] extends [undefined]
    ? Response | undefined | void
    : ResponseBodyType extends Record<string, any> | undefined
      ? StrictResponse<ResponseBodyType> | DefaultUnsafeFetchResponse | undefined | void
      : StrictResponse<ResponseBodyType> | undefined | void
export type ResponseResolverFinalizeFunction = (callback: () => MaybePromise<void>) => void
export type ResponseResolverInfo<
  ResolverExtraInfo extends Record<string, unknown> = Record<string, unknown>,
  RequestBodyType extends DefaultBodyType = DefaultBodyType,
> = {
  request: StrictRequest<RequestBodyType extends JsonBodyType ? RequestBodyType : JsonBodyType>
  requestId: string
  finalize: ResponseResolverFinalizeFunction
} & ResolverExtraInfo
export type ResponseResolver<
  ResolverExtraInfo extends Record<string, unknown> = Record<string, unknown>,
  RequestBodyType extends DefaultBodyType = DefaultBodyType,
  ResponseBodyType extends DefaultBodyType = undefined,
> = (info: ResponseResolverInfo<ResolverExtraInfo, RequestBodyType>) => AsyncResponseResolverReturnType<ResponseBodyType>
export type AsyncResponseResolverReturnType<ResponseBodyType extends DefaultBodyType = undefined> = MaybePromise<
  ResponseResolverReturnType<ResponseBodyType>
  | Iterable<MaybePromise<ResponseResolverReturnType<ResponseBodyType>>>
  | AsyncIterable<MaybePromise<ResponseResolverReturnType<ResponseBodyType>>>
>

/** A facade handler is intentionally HTTP-only; use `mokup/ws` for WebSocket handlers. */
export type AnyHandler = HttpHandler
export type RequestHandler = HttpHandler
export interface SharedOptions { onUnhandled?: unknown }
export type StrictResponseBody<Body> = StrictResponse<Body>
export type PassthroughResponse = PassthroughResult
export interface ResponseResolutionContext { baseUrl?: string, quiet?: boolean }
export type UnhandledFrameStrategy = 'bypass' | 'warn' | 'error'
export interface UnhandledFrameHandle { readonly requestId: string }
export interface LifeCycleEventMap {
  'request:start': { readonly request: Request, readonly requestId: string }
  'request:match': { readonly request: Request, readonly requestId: string }
  'request:unhandled': { readonly request: Request, readonly requestId: string }
  'request:end': { readonly request: Request, readonly requestId: string }
  'response:mocked': { readonly request: Request, readonly response: Response, readonly requestId: string }
  'response:bypass': { readonly request: Request, readonly requestId: string }
  'unhandledException': { readonly error: unknown, readonly request: Request, readonly requestId: string }
}
export interface LifeCycleEventEmitter<EventMap = LifeCycleEventMap> {
  on: <Type extends keyof EventMap>(type: Type, listener: (event: EventMap[Type]) => void) => () => void
  removeListener: <Type extends keyof EventMap>(type: Type, listener: (event: EventMap[Type]) => void) => void
  removeAllListeners: (type?: keyof EventMap) => void
}
