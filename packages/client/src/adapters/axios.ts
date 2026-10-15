import type { MockResolver, MockResolverOptions, RequestDescriptor } from '../core'
import { createMockResolver } from '../core'
import { mergeHeaders, normalizeHeaders } from '../utils'

const AXIOS_ABSOLUTE_URL_RE = /^(?:[a-z][a-z\d+.-]*:)?\/\//i
const TRAILING_SLASHES_RE = /\/+$/
const LEADING_SLASHES_RE = /^\/+/
const URL_PARSER_CONTROLS_RE = /[\t\n\r]/g
const MALFORMED_HTTP_URL_RE = /^https?:(?!\/\/)/i

export interface AxiosRequestConfig {
  url?: string
  baseURL?: string
  allowAbsoluteUrls?: boolean
  method?: string
  headers?: Record<string, string>
  params?: unknown
  data?: unknown
  mock?: boolean
  meta?: Record<string, unknown>
  signal?: AbortSignal
}

type AxiosResolverConfig = Omit<AxiosRequestConfig, 'signal'>

export interface AxiosInstanceLike<TConfig extends AxiosResolverConfig = AxiosRequestConfig> {
  defaults?: {
    baseURL?: string
    allowAbsoluteUrls?: boolean
  }
  interceptors: {
    request: {
      use: (
        onFulfilled: (
          config: TConfig,
        ) => TConfig | Promise<TConfig>,
      ) => unknown
    }
  }
}

export interface AxiosAdapterOptions {
  resolver?: MockResolver
  resolverOptions?: MockResolverOptions
}

function combineBaseUrl(baseURL: string | undefined, url: string | undefined, allowAbsoluteUrls?: boolean): string {
  if (baseURL && (!url || !AXIOS_ABSOLUTE_URL_RE.test(url) || allowAbsoluteUrls === false)) {
    return url
      ? `${baseURL.replace(TRAILING_SLASHES_RE, '')}/${url.replace(LEADING_SLASHES_RE, '')}`
      : baseURL
  }
  return url ?? ''
}

function isMalformedHttpUrl(url: string | undefined) {
  if (typeof url !== 'string') {
    return false
  }
  let start = 0
  while (start < url.length && url.charCodeAt(start) <= 0x20) {
    start++
  }
  return MALFORMED_HTTP_URL_RE.test(url.slice(start).replace(URL_PARSER_CONTROLS_RE, ''))
}

function applyHeaders(
  headers: AxiosRequestConfig['headers'],
  originalHeaders: Record<string, string> | undefined,
  nextHeaders: Record<string, string>,
) {
  if (headers) {
    const candidate: Record<string, unknown> = headers
    if (typeof candidate['set'] === 'function') {
      for (const [name, value] of Object.entries(nextHeaders)) {
        if (originalHeaders?.[name] !== value) {
          candidate['set'](name, value)
        }
      }
      return headers
    }
  }
  return nextHeaders
}

export function createAxiosRequestInterceptor(options: AxiosAdapterOptions = {}) {
  const resolver = options.resolver ?? createMockResolver(options.resolverOptions)
  return async <TConfig extends AxiosResolverConfig>(config: TConfig) => {
    const baseURL = config.baseURL
    const usesBase = baseURL && (!config.url || !AXIOS_ABSOLUTE_URL_RE.test(config.url) || config.allowAbsoluteUrls === false)
    // Leave invalid URLs intact so Axios can report its native validation error.
    if (isMalformedHttpUrl(config.url) || (usesBase && isMalformedHttpUrl(baseURL))) {
      return config
    }
    const resolvedUrl = combineBaseUrl(baseURL, config.url, config.allowAbsoluteUrls)
    const descriptor: RequestDescriptor = {
      url: resolvedUrl || config.url || baseURL || '',
    }
    if (config.method) {
      descriptor.method = config.method
    }
    if (config.headers) {
      descriptor.headers = normalizeHeaders(config.headers)
    }
    if (typeof config.mock === 'boolean') {
      descriptor.mock = config.mock
    }
    if (config.meta) {
      descriptor.meta = config.meta
    }
    if (typeof config.data !== 'undefined') {
      descriptor.body = config.data
    }
    const resolved = resolver.resolve(descriptor)
    const nextHeaders = mergeHeaders(descriptor.headers, resolved.headers)

    return {
      ...config,
      baseURL: '',
      url: resolved.url,
      headers: applyHeaders(config.headers, descriptor.headers, nextHeaders),
    }
  }
}

export function applyMokupToAxios<TConfig extends AxiosResolverConfig>(instance: AxiosInstanceLike<TConfig>, options: AxiosAdapterOptions = {}) {
  instance.interceptors.request.use(createAxiosRequestInterceptor(options))
}
