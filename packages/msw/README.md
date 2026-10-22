# @mokup/msw

An **import-level HTTP migration facade** for Mokup. It provides familiar HTTP handler and lifecycle names while executing Mokup handlers. It adapts compatible MSW 3 HTTP handler objects and does not implement every MSW API.

```sh
pnpm add -D @mokup/msw
```

```ts
import { http, HttpResponse } from '@mokup/msw'
import { setupServer } from '@mokup/msw/node'

const server = setupServer(
  http.get('https://api.example.com/users/:id', ({ params }) =>
    HttpResponse.json({ id: params['id'], name: 'Ada' })),
)

server.listen({ onUnhandledFrame: 'error' })
try {
  console.log(await (await fetch('https://api.example.com/users/1')).json())
}
finally {
  await server.close()
}
```

Change handler **definitions** to import from `@mokup/msw` (including imports from MSW 3's `msw/http`), and change `msw/node` or `msw/browser` imports to `@mokup/msw/node` or `@mokup/msw/browser`. Recreate the handlers after changing imports. Keep MSW installed while migrating any unsupported code separately.

| Supported subset                                          | Behavior                                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `http.get/post/put/patch/delete/head/options/all`         | Mokup string, RegExp, or predicate matching; `{ once: true }`                                  |
| `HttpResponse`                                            | Native Response plus `json`, `text`, `html`, `xml`, `arrayBuffer`, `formData`, `error` helpers |
| `delay`, `passthrough`, `networkError`                    | Mokup implementations; cancellable delay accepts `{ signal }`                                  |
| `setupServer`                                             | Node fetch, ClientRequest, and available XHR interception                                      |
| `setupWorker`                                             | Mokup Service Worker by default, or explicit `mode: 'interceptor'` page Fetch/XHR              |
| `use`, `resetHandlers`, `restoreHandlers`, `listHandlers` | Session-owned overrides and one-shot consumption                                               |
| `onUnhandledFrame`, `onUnhandledRequest`                  | MSW 3 string policy and MSW 2 alias; `bypass`, `warn`, `error`; defaults to `warn`             |
| Cleanup                                                   | Await `server.close()` / `worker.stop()`                                                       |

Typed params/request/response bodies and `HttpResponse<T>` are supported. The facade also exports common HTTP aliases such as `HttpMethods`, `StrictRequest`, `HttpResponseResolver`, and lifecycle event types. Lifecycle listeners receive MSW-shaped `{ request, requestId }` payloads, plus `{ response }` metadata for mocked responses; the response body remains owned by the application stream. Unsupported: complete MSW type-alias compatibility, `bypass(request)` utilities, GraphQL/WebSocket exports, `quiet`, and undocumented MSW startup options. Unsupported start options fail explicitly. Mokup has separate `mokup/graphql`, `mokup/sse`, and `mokup/ws` APIs; they are not facade compatibility claims.

The facade defaults to warning on unhandled HTTP requests. `onUnhandledFrame` supports MSW 3 strategies and callbacks; `onUnhandledRequest` accepts the MSW 2 alias and callback shape. Conflicting aliases are rejected. The compatibility execution policy follows MSW 3.0.2 for generator exhaustion, thrown responses, ordinary `once`, and once generators.

String matching uses `@msw/url`, also used by MSW 3, including optional/splat parameters and host/path wildcards; browser relative masks resolve against the page. Browser mocks use a per-owner, in-memory cookie jar with credentials, Domain/Path, expiry, Secure and SameSite support; cookies are resolver metadata and do not write real browser cookies. See the guide for `HttpResponse` Set-Cookie examples and boundaries.

Browser startup uses Mokup's worker protocol, not MSW's worker script. Copy the `mokup/mockServiceWorker.js` asset into your app's public directory first, then use `start({ serviceWorker: { url: '/mockServiceWorker.js' } })`. The explicit `mode: 'interceptor'` fallback covers page Fetch/XHR only; it does not cover navigation, subresources, separate workers, or other tabs. See the guide for the asset-copy command.

Node requirement: `>=22.12.0`. ESM-only. See the [network mocking guide](https://mokup.icebreaker.top/advanced/network-mocking).
