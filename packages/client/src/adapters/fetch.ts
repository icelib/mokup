import type { MockResolver, MockResolverOptions, RequestDescriptor } from '../core'
import { createMockResolver } from '../core'
import { mergeHeaders, normalizeHeaders } from '../utils'
import { toRewrittenRequestInit } from './fetch-request'

export type MokupFetchInit = RequestInit & {
  mock?: boolean
  meta?: Record<string, unknown>
}

export interface FetchAdapterOptions {
  fetch?: typeof fetch
  resolver?: MockResolver
  resolverOptions?: MockResolverOptions
}

export function createFetchAdapter(options: FetchAdapterOptions = {}) {
  const resolver = options.resolver ?? createMockResolver(options.resolverOptions)
  const fetchImpl = options.fetch ?? (typeof fetch !== 'undefined' ? fetch : undefined)

  if (!fetchImpl) {
    throw new Error('fetch is not available in the current runtime.')
  }

  return async function mokupFetch(input: RequestInfo | URL, init?: MokupFetchInit) {
    const { mock: _mock, meta: _meta, ...cleanInit } = init ?? {}
    const hasRequest = typeof Request !== 'undefined' && input instanceof Request
    const sourceRequest = hasRequest ? new Request(input, cleanInit) : undefined
    const url = input instanceof URL ? input.toString() : (hasRequest ? sourceRequest!.url : String(input))
    const headers = normalizeHeaders(sourceRequest?.headers ?? cleanInit.headers)
    const descriptor: RequestDescriptor = {
      url,
      headers,
    }
    const method = sourceRequest?.method ?? init?.method
    if (method) {
      descriptor.method = method
    }
    if (sourceRequest?.body || typeof cleanInit.body !== 'undefined') {
      descriptor.body = sourceRequest ? sourceRequest.body : cleanInit.body
    }
    if (typeof init?.mock === 'boolean') {
      descriptor.mock = init.mock
    }
    if (init?.meta) {
      descriptor.meta = init.meta
    }

    const resolved = resolver.resolve(descriptor)
    const nextHeaders = mergeHeaders(descriptor.headers, resolved.headers)

    if (sourceRequest) {
      if (resolved.url === sourceRequest.url) {
        return fetchImpl(sourceRequest, { headers: nextHeaders })
      }
      return fetchImpl(resolved.url, await toRewrittenRequestInit(sourceRequest, nextHeaders))
    }

    return fetchImpl(resolved.url, {
      ...cleanInit,
      headers: nextHeaders,
    })
  }
}
