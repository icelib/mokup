import type {
  AxiosRequestConfig,
  MockResolver,
  MockResolverOptions,
  MokupFetchInit,
  RequestDescriptor,
} from '@mokup/client'
import {
  createAxiosRequestInterceptor,
  createFetchAdapter,
  createMockResolver,

} from '@mokup/client'
import { prepareFetchBody } from './fetch-body'
import { defaultTransformResponse } from './fetch-response'
import { isRecord, isRequestDescriptor, normalizeRequest } from './request-utils'

export { MokupHttpError } from './fetch-response'

export type QueryKey = readonly unknown[]

export interface QueryFunctionContext {
  queryKey: QueryKey
  signal?: AbortSignal
  meta?: Record<string, unknown>
}

export type QueryFunction<TData = unknown> = (context: QueryFunctionContext) => Promise<TData>

export type MutationFunction<TData = unknown, TVariables = unknown> = (variables: TVariables) => Promise<TData>

export interface QueryClientLike {
  setDefaultOptions?: (options: {
    queries?: { queryFn?: QueryFunction }
    mutations?: { mutationFn?: MutationFunction }
  }) => void
  getDefaultOptions?: () => {
    queries?: { queryFn?: QueryFunction }
    mutations?: { mutationFn?: MutationFunction }
  }
  defaultOptions?: {
    queries?: { queryFn?: QueryFunction }
    mutations?: { mutationFn?: MutationFunction }
  }
}

export type BuildRequest = (queryKey: QueryKey, meta?: Record<string, unknown>) => RequestDescriptor | null
export type BuildMutationRequest = (variables: unknown) => RequestDescriptor | null

export type RequestExecutor = (
  request: RequestDescriptor,
  context?: { signal?: AbortSignal },
) => Promise<unknown>

export interface FetchExecutorOptions {
  fetch?: typeof fetch
  resolver?: MockResolver
  resolverOptions?: MockResolverOptions
  /** Replaces default HTTP status checking and response parsing, including for non-2xx responses. */
  transformResponse?: (response: Response) => Promise<unknown>
}

export interface AxiosExecutorOptions {
  axios: {
    request: (config: Record<string, unknown>) => Promise<unknown>
    defaults?: {
      baseURL?: string
      allowAbsoluteUrls?: boolean
    }
  }
  resolver?: MockResolver
  resolverOptions?: MockResolverOptions
  selectResponse?: (response: unknown) => unknown
}

export interface MokupQueryOptions {
  resolver?: MockResolver
  resolverOptions?: MockResolverOptions
  buildRequest?: BuildRequest
  buildMutationRequest?: BuildMutationRequest
  executor?: RequestExecutor
  fetch?: typeof fetch
  /** Replaces default HTTP status checking and response parsing, including for non-2xx responses. */
  transformResponse?: (response: Response) => Promise<unknown>
}

const methodMatch = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

function defaultBuildRequest(queryKey: QueryKey, meta?: Record<string, unknown>): RequestDescriptor | null {
  if (isRecord(meta) && isRequestDescriptor(meta['request'])) {
    return meta['request']
  }
  if (isRequestDescriptor(queryKey)) {
    return queryKey
  }
  if (!Array.isArray(queryKey) || queryKey.length === 0) {
    return null
  }

  const [first, second, third] = queryKey
  if (typeof first === 'string' && typeof second === 'string') {
    const method = methodMatch.has(first.toUpperCase()) ? first.toUpperCase() : 'GET'
    const extras = isRecord(third) ? third : {}
    return {
      url: second,
      method,
      ...extras,
    }
  }
  if (typeof first === 'string') {
    const extras = isRecord(second) ? second : {}
    return {
      url: first,
      method: 'GET',
      ...extras,
    }
  }
  return null
}

function defaultBuildMutationRequest(variables: unknown): RequestDescriptor | null {
  if (isRequestDescriptor(variables)) {
    return variables
  }
  if (Array.isArray(variables) && variables.length > 0) {
    const [first, second, third] = variables
    if (typeof first === 'string' && typeof second === 'string') {
      const method = methodMatch.has(first.toUpperCase()) ? first.toUpperCase() : 'POST'
      const extras = isRecord(third) ? third : {}
      return {
        url: second,
        method,
        ...extras,
      }
    }
  }
  return null
}

export function createFetchExecutor(options: FetchExecutorOptions = {}): RequestExecutor {
  const resolver = options.resolver ?? createMockResolver(options.resolverOptions)
  const fetchImpl = options.fetch ?? globalThis.fetch
  const adapter = createFetchAdapter({
    resolver,
    ...(fetchImpl
      ? {
          fetch: (input, init) => {
            // Resolvers inspect the original body; encode only at the transport boundary.
            const { body, ...rest } = init ?? {}
            return fetchImpl(input, { ...rest, ...prepareFetchBody(body, rest.headers) })
          },
        }
      : {}),
  })
  const transform = options.transformResponse

  return async (descriptor, context) => {
    const normalized = normalizeRequest(descriptor, descriptor.meta as Record<string, unknown> | undefined)
    const init: MokupFetchInit = {
      ...(normalized.headers ? { headers: normalized.headers as HeadersInit } : {}),
      ...(normalized.method ? { method: normalized.method } : {}),
      ...(typeof normalized.body !== 'undefined' ? { body: normalized.body as BodyInit | null } : {}),
      ...(context?.signal ? { signal: context.signal } : {}),
      ...(typeof normalized.mock === 'boolean' ? { mock: normalized.mock } : {}),
      ...(normalized.meta ? { meta: normalized.meta as Record<string, unknown> } : {}),
    }
    const response = await adapter(normalized.url, init)
    return transform ? transform(response) : defaultTransformResponse(response, normalized.method)
  }
}

export function createAxiosExecutor(options: AxiosExecutorOptions): RequestExecutor {
  const resolver = options.resolver ?? createMockResolver(options.resolverOptions)
  const interceptor = createAxiosRequestInterceptor({ resolver })
  const select = options.selectResponse ?? ((response: unknown) => {
    if (isRecord(response) && 'data' in response) {
      return response['data']
    }
    return response
  })

  return async (descriptor, context) => {
    const normalized = normalizeRequest(descriptor, descriptor.meta as Record<string, unknown> | undefined)
    const defaults = options.axios.defaults
    const config: AxiosRequestConfig = {
      url: normalized.url,
      ...(typeof defaults?.baseURL === 'string' ? { baseURL: defaults.baseURL } : {}),
      ...(typeof defaults?.allowAbsoluteUrls === 'boolean' ? { allowAbsoluteUrls: defaults.allowAbsoluteUrls } : {}),
      ...(normalized.method ? { method: normalized.method } : {}),
      ...(normalized.headers ? { headers: normalized.headers as Record<string, string> } : {}),
      ...(typeof normalized.body !== 'undefined' ? { data: normalized.body } : {}),
      ...(typeof normalized.mock === 'boolean' ? { mock: normalized.mock } : {}),
      ...(normalized.meta ? { meta: normalized.meta as Record<string, unknown> } : {}),
      ...(context?.signal ? { signal: context.signal } : {}),
    }
    const resolvedConfig = await interceptor(config)

    const response = await options.axios.request({ ...resolvedConfig })
    return select(response)
  }
}

export function createMokupQueryClient(options: MokupQueryOptions = {}) {
  const resolver = options.resolver ?? createMockResolver(options.resolverOptions)
  const buildRequest = options.buildRequest ?? defaultBuildRequest
  const buildMutationRequest = options.buildMutationRequest ?? defaultBuildMutationRequest
  const executor = options.executor ?? createFetchExecutor({
    resolver,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.transformResponse ? { transformResponse: options.transformResponse } : {}),
  })

  const queryFn: QueryFunction = async (context) => {
    const request = buildRequest(context.queryKey, context.meta)
    if (!request) {
      throw new Error('Failed to build request from queryKey. Provide buildRequest to customize.')
    }
    const normalized = normalizeRequest(request, context.meta)
    return executor(normalized, context.signal ? { signal: context.signal } : undefined)
  }

  const mutationFn: MutationFunction = async (variables) => {
    const request = buildMutationRequest(variables)
    if (!request) {
      throw new Error('Failed to build request from mutation variables. Provide buildMutationRequest to customize.')
    }
    return executor(normalizeRequest(request))
  }

  return {
    queryFn,
    mutationFn,
    buildRequest,
    buildMutationRequest,
    executor,
    resolver,
  }
}

export function applyMokupToQueryClient(
  queryClient: QueryClientLike,
  options: MokupQueryOptions = {},
) {
  const mokup = createMokupQueryClient(options)
  const current = queryClient.getDefaultOptions?.() ?? queryClient.defaultOptions ?? {}
  const next = {
    ...current,
    queries: {
      ...(current.queries ?? {}),
      queryFn: mokup.queryFn,
    },
    mutations: {
      ...(current.mutations ?? {}),
      mutationFn: mokup.mutationFn,
    },
  }

  if (queryClient.setDefaultOptions) {
    queryClient.setDefaultOptions(next)
  }
  else {
    queryClient.defaultOptions = next
  }

  return mokup
}
