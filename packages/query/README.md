# @mokup/query

TanStack Query integrations for Mokup request switching.

## Requirements

- Node.js `^20.19.0 || >=22.12.0`

## Upgrade notes

- This package now ships ESM-only output.
- The default Fetch executor now rejects non-2xx responses with `MokupHttpError`, so TanStack Query treats HTTP failures as errors. A custom `transformResponse` supplies the complete response policy.
- The Fetch executor now JSON-encodes plain object and array request bodies. It adds `Content-Type: application/json` only when no content type is supplied.
- Full migration guide: [../../docs/guide/migration-v1.md](../../docs/guide/migration-v1.md)

## Install

```bash
pnpm add @mokup/query @mokup/client
```

## Quick start (global defaults)

```ts
import { applyMokupToQueryClient } from '@mokup/query'
import { QueryClient } from '@tanstack/react-query'

const queryClient = new QueryClient()

applyMokupToQueryClient(queryClient, {
  resolverOptions: {
    mockBase: 'http://localhost:3300',
    realBase: 'https://api.example.com',
    pathMap: [{ from: '/api/*', to: '/*' }],
    markers: { header: true },
  },
})
```

## Query key convention

Default `queryKey` shapes:

```ts
const keyA = ['GET', '/users', { params, headers, body, mock: true }]
const keyB = ['/users', { params, mock: true }]
```

Per-request override using `meta`:

```ts
useQuery({
  queryKey: ['GET', '/users'],
  meta: { mokup: true },
})
```

If your app already has custom query keys, provide `buildRequest` to map them.

## Custom request mapping

```ts
import { createMokupQueryClient } from '@mokup/query'

const { queryFn, mutationFn } = createMokupQueryClient({
  buildRequest(queryKey, meta) {
    const [resource, params] = queryKey as [string, Record<string, unknown>?]
    return {
      url: resource,
      method: 'GET',
      params,
      meta,
    }
  },
})
```

## Using axios

```ts
import { applyMokupToQueryClient, createAxiosExecutor } from '@mokup/query'
import axios from 'axios'

const executor = createAxiosExecutor({
  axios,
  resolverOptions: {
    mockBase: 'http://localhost:3300',
    realBase: 'https://api.example.com',
  },
})

applyMokupToQueryClient(queryClient, { executor })
```

You can also pass an Axios instance created with `axios.create()`. The executor
reads its current `defaults.baseURL` and `defaults.allowAbsoluteUrls` on every
request, combines the URL using Axios rules, then applies the Mokup resolver.
For example, a base URL ending in `/api/v1` and a query URL `/users` retain the
`/api/v1/users` path. No request interceptor is installed on the instance.

## Using fetch

```ts
import { applyMokupToQueryClient, createFetchExecutor } from '@mokup/query'

const executor = createFetchExecutor({
  resolverOptions: {
    mockBase: 'http://localhost:3300',
    realBase: 'https://api.example.com',
  },
})

applyMokupToQueryClient(queryClient, { executor })
```

The default Fetch executor rejects non-2xx responses with `MokupHttpError`
before reading the response body. Successful `HEAD` requests and HTTP 204/205
responses return an empty string, including when a JSON content type is present.
Other successful responses use `response.json()` when the content type contains
`application/json`, or `response.text()` otherwise. Empty or malformed JSON on
a regular successful response still rejects with its JSON parse error.
This also applies when `createMokupQueryClient` or `applyMokupToQueryClient`
creates the default executor.

### Reading HTTP errors

`MokupHttpError` extends `Error`, has the name `MokupHttpError`, and exposes
readonly `response`, `status`, and `statusText` properties. Its `response` is
the original Fetch `Response`, whose body is still available to read:

```ts
import { createFetchExecutor, MokupHttpError } from '@mokup/query'

const executor = createFetchExecutor()

try {
  await executor({ url: '/users', method: 'GET' })
}
catch (error) {
  if (!(error instanceof MokupHttpError)) {
    throw error
  }
  const details = await error.response.text()
  console.error(error.status, error.statusText, details)
}
```

### Custom response handling

`transformResponse` receives every response, including non-2xx responses,
and completely replaces the default status check and body parsing. For example,
this executor treats a missing user as `null` and rejects other HTTP failures:

```ts
import { createFetchExecutor, MokupHttpError } from '@mokup/query'

const executor = createFetchExecutor({
  async transformResponse(response) {
    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new MokupHttpError(response)
    }
    return response.json()
  },
})
```

You can also pass `transformResponse` to `createMokupQueryClient` or
`applyMokupToQueryClient` when using their default Fetch executor.

### Request bodies

Plain objects, including objects with a null prototype or from another realm,
and arrays are encoded with `JSON.stringify`. The executor adds
`Content-Type: application/json` only if the request has no content type;
an explicitly supplied content type is preserved.
Custom resolvers still receive the original body and may supply a content type;
JSON encoding happens after resolution, immediately before Fetch.

```ts
await executor({
  url: '/users',
  method: 'POST',
  body: { name: 'Ada' },
})
```

Native Fetch `BodyInit` values, such as strings, `FormData`, `URLSearchParams`,
`Blob`, buffers, typed arrays, and streams, pass through without JSON encoding
or an added JSON content type. These response and body rules belong to the
Query Fetch executor; `@mokup/client`'s raw Fetch adapter retains native Fetch
response semantics, and the Axios executor uses Axios behavior.
