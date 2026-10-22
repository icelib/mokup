import type { HttpHandler, HttpHandlerOptions, HttpMatcher, HttpResolver, HttpResolverIterable, HttpResolverResult } from 'mokup/http'
import type { HttpRequestHandler } from './compat-types'
import { isHttpResponse, http as nativeHttp, passthrough } from 'mokup/http'

const execution = Object.freeze({ consumeOnce: 'execution', sequence: 'repeat-last', onceSequence: 'exhaustion', relativeUrls: 'page' } as const)

function method(factory: typeof nativeHttp.get): HttpRequestHandler {
  return ((matcher: HttpMatcher, resolver: HttpResolver, options?: HttpHandlerOptions) => Object.freeze({
    ...factory(matcher, resolver, options),
    execution,
  })) as unknown as HttpRequestHandler
}

/** MSW HTTP execution semantics, with state still owned by each Mokup session. */
export const http: {
  all: HttpRequestHandler
  head: HttpRequestHandler
  get: HttpRequestHandler
  post: HttpRequestHandler
  put: HttpRequestHandler
  delete: HttpRequestHandler
  patch: HttpRequestHandler
  options: HttpRequestHandler
} = {
  get: method(nativeHttp.get),
  post: method(nativeHttp.post),
  put: method(nativeHttp.put),
  patch: method(nativeHttp.patch),
  delete: method(nativeHttp.delete),
  head: method(nativeHttp.head),
  options: method(nativeHttp.options),
  all: method(nativeHttp.all),
}

/** Public MSW HTTP shape; protected resolver state is validated at the migration boundary. */
export interface MswHttpHandler {
  readonly kind: 'request'
  readonly info: { method: string | RegExp, path: unknown }
}

export type CompatibleHandler = HttpHandler | MswHttpHandler

function normalizeResult(value: HttpResolverResult): HttpResolverResult {
  return isHttpResponse(value) && value.headers.get('x-msw-intention') === 'passthrough' ? passthrough() : value
}

async function* migrateSequence(sequence: HttpResolverIterable): AsyncGenerator<HttpResolverResult, HttpResolverResult> {
  const iterator = Symbol.asyncIterator in sequence ? sequence[Symbol.asyncIterator]() : sequence[Symbol.iterator]()
  try {
    while (true) {
      const next = await iterator.next()
      const value = normalizeResult(await next.value)
      if (next.done) {
        return value
      }
      yield value
    }
  }
  finally {
    await iterator.return?.()
  }
}

function migrateResolver(resolver: HttpResolver): HttpResolver {
  return async (context) => {
    let result
    try {
      result = await resolver(context)
    }
    catch (error) {
      if (!isHttpResponse(error)) {
        throw error
      }
      result = error
    }
    return result && typeof result === 'object' && !isHttpResponse(result) && (Symbol.iterator in result || Symbol.asyncIterator in result)
      ? migrateSequence(result as HttpResolverIterable)
      : normalizeResult(result as HttpResolverResult)
  }
}

export function createHandlerAdapter() {
  const adapted = new WeakMap<object, HttpHandler>()
  return (handler: CompatibleHandler): HttpHandler => {
    const cached = handler && adapted.get(handler)
    if (cached) {
      return cached
    }
    if (handler && 'matcher' in handler && typeof handler.resolver === 'function' && typeof handler.once === 'boolean'
      && (typeof handler.method === 'string' || handler.method instanceof RegExp)) {
      return handler
    }
    if (!handler || !('kind' in handler) || handler.kind !== 'request' || !handler.info
      || !(typeof handler.info.method === 'string' || handler.info.method instanceof RegExp)
      || !(typeof handler.info.path === 'string' || typeof handler.info.path === 'function' || handler.info.path instanceof RegExp)) {
      throw new TypeError('@mokup/msw requires Mokup or MSW HTTP handlers.')
    }
    const resolver: unknown = Reflect.get(handler, 'resolver')
    const options: unknown = Reflect.get(handler, 'options')
    if (typeof resolver !== 'function' || (options !== undefined && (!options || typeof options !== 'object'
      || ('once' in options && typeof options.once !== 'boolean')))) {
      throw new TypeError('@mokup/msw could not read this MSW HTTP definition; recreate it using @mokup/msw/http.')
    }
    const definition: HttpHandler = Object.freeze({
      method: typeof handler.info.method === 'string' ? handler.info.method.toUpperCase() : new RegExp(handler.info.method.source, handler.info.method.flags),
      // MSW exposes path predicates as an untyped Function. The migration
      // boundary validates that it is callable, then treats it as Mokup's
      // narrower HttpPredicate contract for the shared matcher pipeline.
      matcher: handler.info.path as HttpMatcher,
      resolver: migrateResolver(resolver as HttpResolver),
      once: Boolean(options && typeof options === 'object' && 'once' in options && options.once),
      execution,
    })
    adapted.set(handler, definition)
    return definition
  }
}
