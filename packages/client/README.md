# @mokup/client

Client-side request switching utilities and adapters for Mokup.

## Requirements

- Node.js `^20.19.0 || >=22.12.0`

## Upgrade notes

- This package now ships ESM-only output.
- Full migration guide: [../../docs/guide/migration-v1.md](../../docs/guide/migration-v1.md)

## Install

```bash
pnpm add @mokup/client
```

## Quick start (fetch)

```ts
import { createFetchAdapter, createMockResolver } from '@mokup/client'

const resolver = createMockResolver({
  mockBase: 'http://localhost:3300',
  realBase: 'https://api.example.com',
  pathMap: [{ from: '/api/*', to: '/*' }],
  markers: { header: true },
})

const mokupFetch = createFetchAdapter({ resolver })

await mokupFetch('/api/users', { mock: true })
```

`mokupFetch` also accepts a native `Request`. Its standard `init` overrides follow
`new Request(request, init)`, including body and signal inheritance. When the
resolver keeps the URL unchanged, the adapter forwards the effective request so
native streaming, `keepalive`, and redirect behavior are preserved.

When the resolver changes a `Request` URL (including query markers), the adapter
buffers its body before sending it. This preserves binary and FormData payloads,
their content type, `keepalive`, and body replay for 307/308 redirects. Cancellation
also interrupts buffering. Use finite bodies on this path; for streaming uploads,
pass a string or `URL` with `init.body` and the options required by your Fetch
implementation. That path passes the body through directly and retains native
streaming and redirect restrictions.

## Quick start (axios)

```ts
import { applyMokupToAxios } from '@mokup/client'
import axios from 'axios'

const api = axios.create({ baseURL: 'https://api.example.com' })

applyMokupToAxios(api, {
  resolverOptions: {
    mockBase: 'http://localhost:3300',
    realBase: 'https://api.example.com',
    pathMap: [{ from: '/api/*', to: '/*' }],
  },
})

await api.request({ url: '/api/users', mock: true })
```

The adapter combines `baseURL` and `url` using Axios rules before applying the
resolver. For example, `baseURL: 'https://api.example.com/api/v1'` with either
`url: 'users'` or `url: '/users'` produces `/api/v1/users`. Absolute and
protocol-relative URLs bypass `baseURL` unless `allowAbsoluteUrls` is `false`.
Changes to `api.defaults.baseURL` and `api.defaults.allowAbsoluteUrls` take effect
on subsequent requests. Resolver options can then rewrite the combined URL.

## Resolver options

- `mockBase`: mock server origin or base path
- `realBase`: real API origin or base path
- `pathMap`: prefix rewrite rules (`/api/* -> /*`)
- `allowHosts`: only rewrite matching hosts, including protocol-relative URLs (`//api.example.com/users`)
- `markers`: inject headers or query markers (`x-mokup`, `__mokup`)
- `storage`: persist global toggle (optional)

## Overrides and priority

Order (highest to lowest):

1. Request `mock` or `meta.mokup`
2. Headers/cookie/query markers
3. Global `setUseMock`
4. `resolverOptions.env.useMock`

## Global switch

```ts
const resolver = createMockResolver({ mockBase, realBase })
resolver.setUseMock(true)

const useMock = resolver.getUseMock()
```
