import type {
  AxiosExecutorOptions,
  BuildMutationRequest,
  BuildRequest,
  FetchExecutorOptions,
  MokupQueryOptions,
  MutationFunction,
  QueryClientLike,
  QueryFunction,
  QueryFunctionContext,
  QueryKey,
  RequestExecutor,
} from '@mokup/query'
import {
  applyMokupToQueryClient,
  createAxiosExecutor,
  createFetchExecutor,
  createMokupQueryClient,
  MokupHttpError,
} from '@mokup/query'
import axios from 'axios'
import { expectAssignable, expectError, expectType } from 'tsd'

const queryKey = ['GET', '/users'] as const satisfies QueryKey
const queryContext: QueryFunctionContext = {
  queryKey,
  meta: {
    request: {
      url: '/users',
      method: 'GET',
    },
  },
}

expectAssignable<QueryKey>(queryKey)
expectType<QueryFunctionContext>(queryContext)

const fetchExecutor = createFetchExecutor({
  resolverOptions: {
    mockBase: 'http://localhost:3300',
    realBase: 'https://api.example.com',
  },
})
expectType<RequestExecutor>(fetchExecutor)
expectType<Promise<unknown>>(fetchExecutor({
  url: '/users',
  method: 'POST',
  body: { name: 'Ada' },
}, { signal: new AbortController().signal }))

const response = new Response(null, { status: 404, statusText: 'Not Found' })
const httpError = new MokupHttpError(response)
expectType<MokupHttpError>(httpError)
expectAssignable<Error>(httpError)
expectType<Response>(httpError.response)
expectType<number>(httpError.status)
expectType<string>(httpError.statusText)
expectAssignable<string>(httpError.name)
expectType<Promise<string>>(httpError.response.text())
expectError(httpError.response = response)
expectError(httpError.status = 500)
expectError(httpError.statusText = 'Internal Server Error')
expectError(new MokupHttpError({ status: 404 }))

declare const unknownError: unknown
if (unknownError instanceof MokupHttpError) {
  expectType<MokupHttpError>(unknownError)
  expectType<Response>(unknownError.response)
}

const fetchOptions: FetchExecutorOptions = {
  async transformResponse(response) {
    expectType<Response>(response)
    return { status: response.status, body: await response.text() }
  },
}
expectType<RequestExecutor>(createFetchExecutor(fetchOptions))

const transformedQueryOptions: MokupQueryOptions = {
  async transformResponse(response) {
    expectType<Response>(response)
    return response.status === 404 ? null : response.text()
  },
}
expectAssignable<QueryFunction>(createMokupQueryClient(transformedQueryOptions).queryFn)

const axiosExecutorOptions: AxiosExecutorOptions = {
  axios: {
    request: async config => ({ data: config }),
  },
}
const axiosExecutor = createAxiosExecutor(axiosExecutorOptions)
expectType<RequestExecutor>(axiosExecutor)

expectType<RequestExecutor>(createAxiosExecutor({
  axios: axios.create({ baseURL: 'https://api.example.com/api/v1', allowAbsoluteUrls: false }),
}))

const buildRequest: BuildRequest = key => ({
  url: String(key[1] ?? '/users'),
  method: 'GET',
})

const buildMutationRequest: BuildMutationRequest = variables => ({
  url: '/users',
  method: 'POST',
  body: variables,
})

const queryOptions: MokupQueryOptions = {
  executor: fetchExecutor,
  buildRequest,
  buildMutationRequest,
}

const mokup = createMokupQueryClient(queryOptions)
expectAssignable<QueryFunction>(mokup.queryFn)
expectAssignable<MutationFunction>(mokup.mutationFn)
expectType<BuildRequest>(mokup.buildRequest)
expectType<BuildMutationRequest>(mokup.buildMutationRequest)
expectType<RequestExecutor>(mokup.executor)

const queryClient: QueryClientLike = {
  defaultOptions: {},
  setDefaultOptions: () => {},
}

const applied = applyMokupToQueryClient(queryClient, queryOptions)
expectType<typeof mokup>(applied)
expectType<typeof mokup>(applyMokupToQueryClient(queryClient, transformedQueryOptions))
