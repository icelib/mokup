# Network mocking, scenarios, and recordings

Mokup supports two complementary authoring styles: file routes for dev servers and deployable manifests, and HTTP handlers for intercepting requests in tests or a browser page. Both use native Fetch requests and responses at their HTTP boundary.

## Five-minute Node example

Install Mokup and save the following as `mock-demo.mjs`:

```sh
pnpm add -D mokup
```

```js
import { http, HttpResponse } from 'mokup/http'
import { setupServer } from 'mokup/node'

const server = setupServer(
  http.get('https://api.example.com/users/:id', ({ params }) =>
    HttpResponse.json({ id: params.id, name: 'Ada' })),
)

server.listen({ onUnhandled: 'error' })
try {
  const response = await fetch('https://api.example.com/users/1')
  console.log(await response.json())
}
finally {
  await server.close()
}
```

Run `node mock-demo.mjs`. The ordinary `fetch` call receives the mock response; no port or application HTTP client wrapper is required. The Node entry supports Fetch, Node ClientRequest, and available XMLHttpRequest. Other transports, including separately configured Undici clients, are not automatically covered.

## Test lifecycle and overrides

```ts
import { http, HttpResponse } from 'mokup/http'
import { setupServer } from 'mokup/node'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'

const server = setupServer(
  http.get('https://api.example.com/users', () => HttpResponse.json([])),
)

beforeAll(() => server.listen({ onUnhandled: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

it('handles a temporary service failure', async () => {
  server.use(http.get('https://api.example.com/users', () =>
    HttpResponse.json({ error: 'unavailable' }, { status: 503 }), { once: true }))
  expect((await fetch('https://api.example.com/users')).status).toBe(503)
  expect((await fetch('https://api.example.com/users')).status).toBe(200)
})
```

`use` prepends overrides; `resetHandlers()` restores the original definitions; `restoreHandlers()` re-enables consumed one-shot definitions. Await cleanup. Node `server.boundary(callback)` isolates handler overrides and one-shot state for the callback's asynchronous work; it does not clone your own module globals or scenario objects.

Use `passthrough()` to stop matching and send a request to the real transport. Use `networkError()` for a transport failure. `delay(milliseconds, { signal: request.signal })` is cancellable. The default unhandled policy is `bypass`; choose `error` for isolated tests or `warn` for development. Native `onUnhandled` callbacks receive request metadata, not a consumable request body.

String handlers use `@msw/url`, also used by MSW 3: named parameters, optional `:id?`, splats `:path*`/`:path+`, and host/path wildcards are supported. Repeated named parameters produce arrays; anonymous wildcards have numeric keys and retain Mokup's `params['*']` alias for the last wildcard. Query strings and fragments do not affect string or RegExp matching; predicates receive the original URL. Relative masks match any origin in Node, but resolve against the current page in browsers; use an absolute URL or leading wildcard for cross-origin browser handlers. `http.get` matches GET only; define `http.head` explicitly.

## File servers, Vite and Webpack sessions

`createFetchServer` dispatches native handlers and file rules through the same session. Initial native handlers take priority. File refreshes preserve temporary overrides and consumed `once` state; `resetHandlers()` restores the latest file version:

```ts
import { http, HttpResponse } from 'mokup/http'
import { createFetchServer } from 'mokup/server'

const server = await createFetchServer({
  entries: { dir: 'mock', watch: false },
  handlers: [http.get('/extra', () => HttpResponse.json({ native: true }))],
  onUnhandled: 'warn',
})
server.mockSession.events.on('request:start', event => console.log(event.requestId, event.url))
server.mockSession.use(http.get('/users', () => HttpResponse.json([]), { once: true }))
try {
  const response = await server.fetch(new Request('http://localhost/extra'))
  console.log(await response.json())
  await server.refresh()
  server.mockSession.resetHandlers()
}
finally {
  await server.dispose()
}
```

`dispose()` permanently closes the session, cancels live streams and stops watching; repeated calls return the same Promise. The compatibility `close()` method only stops file watching. Use `dispose()` for complete teardown. Internal Playground requests do not generate Mock request events.

For programmatic Vite servers, obtain the current generation's session after configuration:

```ts
import { http, HttpResponse } from 'mokup/http'
import mokup from 'mokup/vite'
import { createServer } from 'vite'

const plugin = mokup({ entries: { dir: 'mock' } })
const vite = await createServer({ plugins: [plugin] })
const session = plugin.api.getMockSession()
session.use(http.get('/api/users', () => HttpResponse.json([]), { once: true }))
await vite.listen()
// Test/integration teardown: await vite.close().
```

Successful refreshes retain subscriptions and overrides; failed scans or signature computation retain the entire previous snapshot. Replacing file rules lets responses already executing those rules finish. Server shutdown cancels unfinished streams. A restarted Vite server has an independent session; obtain it again and renew subscriptions.

Native rules work on additional paths and with an empty mock directory. Both plugins accept top-level `handlers` and `onUnhandled` options. In Vite these options currently require the default `runtime: 'node'`. The policy applies to every request that reaches mock middleware, including unmatched assets; use a callback to restrict a strict policy to your API paths. Connect copies non-GET/HEAD uploads before dispatch, retains their bytes for downstream middleware on passthrough, and streams mocked responses with backpressure. Upload bodies are buffered.

Webpack owns a session per compiler and watch generation:

```ts
import { http, HttpResponse } from 'mokup/http'
import { createWebpackPlugin } from 'mokup/webpack'

export const plugin = createWebpackPlugin({
  entries: { dir: 'mock' },
  handlers: [http.get('/extra', () => HttpResponse.json({ native: true }))],
  onUnhandled: 'bypass',
})

export default { plugins: [plugin], devServer: {} }
```

After the compiler starts, use `plugin.api.getMockSession(compiler)` for controls and subscriptions. Pass the compiler explicitly when sharing one plugin across multiple configurations. Failed bundle builds preserve the HTTP baseline; refresh keeps temporary overrides and once consumption. `watchClose` cancels live responses and closes the old session. Middleware that remains mounted serves the last file snapshot with fresh state while watching is paused. Compiler shutdown also closes that snapshot; restarted watching has an independent session and reloads the files.

## Deployed middleware and Worker sessions

Manifest adapters accept initial `handlers` and `onUnhandled` options. Fetch, Hono, Worker, Connect, Express, Koa and Fastify expose `ready`, `use`, `resetHandlers`, `restoreHandlers`, `listHandlers`, `setOnUnhandled`, `events`, `signal` and `close` on the returned handler/plugin:

```ts
import { http, HttpResponse } from 'mokup/http'
import { createFetchHandler } from 'mokup/server/fetch'

const handler = createFetchHandler({
  manifest: { version: 1, routes: [] },
  handlers: [http.get('/health', () => HttpResponse.json({ ok: true }))],
  onUnhandled: 'warn',
})
handler.use(http.get('/users', () => HttpResponse.json([]), { once: true }))
try {
  await handler(new Request('https://preview.example.test/users'))
  handler.restoreHandlers()
}
finally {
  await handler.close()
}
```

`ready()` resolves the shared session and lazily loads the manifest. Subscriptions and controls can be installed first. `close()` permanently closes the adapter, releases live streams and cancels requests waiting for a manifest; Fastify also closes its session with the application. Ordinary async resolvers can execute concurrently from their first invocation; generator steps share one serialized sequence per session.

Fetch adapters preserve the input Request body, including when a predicate/resolver reads a copy and returns `passthrough()`. Native Node middleware buffers replayable upload copies and streams responses with backpressure. Pass a parsed body from framework middleware when it has already consumed the upload. The older minimal structural request/response interfaces retain their buffered compatibility path.

Worker `fetch(request, env, executionCtx)` and Hono middleware forward each request's bindings and execution context to file handlers. Native resolvers receive them through `context`. Forward the original execution context; binding access and `waitUntil` retain the request's owner. `onNotFound` selects downstream/404 behavior after bypass, while `onUnhandled` controls actual misses. Worker helpers always produce a Response, falling back to 404.

Mount Hono middleware through a child application. Relative HTTP matchers and file paths use its mount scope; resolver Requests and lifecycle events retain the full original URL. Hono compatibility handlers retain parent parameters and variables. The same controls work when a child is mounted more than once:

```ts
import { Hono } from 'hono'
import { createHonoMiddleware } from 'mokup/server/node'

const middleware = createHonoMiddleware({ manifest: { version: 1, routes: [] } })
const child = new Hono().basePath('/api')
child.use('*', middleware)
const app = new Hono().route('/teams/:tenant', child)
middleware.use(http.get('/health', ({ request }) => HttpResponse.text(request.url)))
// GET /teams/team/api/health returns the full original URL.
```

Compiled manifest generations own copies of their routing, middleware and response metadata, including static JSON bodies. Mutating the caller's manifest after initialization cannot change lazy handler execution. Supply a new runtime or refresh the file server to publish a new generation.

## Browser startup

```ts
import { setupWorker } from 'mokup/browser'
import { http, HttpResponse } from 'mokup/http'

const worker = setupWorker(
  http.get('/api/users', () => HttpResponse.json([{ id: 1, name: 'Ada' }])),
)
await worker.start({ onUnhandled: 'warn', serviceWorker: { url: '/mockServiceWorker.js' } })
// Start the application after interception is active.
// Call await worker.stop() when the owning test or page integration is disposed.
```

By default, startup registers Mokup's Service Worker in a secure browser context. Copy its asset once before starting the dev server:

```js
// scripts/copy-mock-worker.mjs
import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
await mkdir('public', { recursive: true })
await copyFile(require.resolve('mokup/mockServiceWorker.js'), 'public/mockServiceWorker.js')
```

Run `node scripts/copy-mock-worker.mjs`; regenerate the file when upgrading Mokup. This is Mokup's script and protocol, not MSW's identically named asset. Startup rejects a conflicting Service Worker in the same scope. `await worker.stop()` disconnects this session; it does not uninstall an existing registration.

Use `start({ mode: 'interceptor' })` explicitly when Service Workers are unavailable. That fallback intercepts page Fetch/XHR only, not browser navigation, subresources, separate workers, or other tabs. Existing [Vite SW mode](../reference/vite-plugin#service-worker-mode) remains the Service Worker option for file routes.

### Browser cookies

Both browser modes keep a virtual cookie jar per active mock owner. Use `HttpResponse` to preserve mocked Set-Cookie values before browser `Response` constructors filter them:

```ts
const worker = setupWorker(
  http.post('/login', () => HttpResponse.json({ ok: true }, {
    headers: { 'Set-Cookie': 'session=demo; Path=/; HttpOnly; SameSite=Lax' },
  })),
  http.get('/session', ({ cookies }) => HttpResponse.json({ session: cookies.session })),
)
```

The jar honors host/Domain, Path, expiry/Max-Age, Secure, SameSite, and request credentials. `credentials: 'omit'` disables reading and storing cookies; cross-origin requests require `include`, and cross-site cookies require `SameSite=None; Secure`. Cookies without SameSite default to Lax. Virtual HttpOnly values are available to resolver `cookies`, and `worker.stop()` clears the jar.

Visible `document.cookie` values are included only for same-origin requests. Browsers do not expose their Path/Domain attributes or real HttpOnly cookies, so those cannot be reconstructed. Virtual values are resolver metadata: they do not write browser cookies, alter `document.cookie`, persist across restarts, or add a Cookie header to real passthrough requests. Plain browser `new Response` has already filtered Set-Cookie; use the `HttpResponse` constructor or its helpers when setting virtual cookies.

## Migrating HTTP imports from MSW

```ts
import { http, HttpResponse } from '@mokup/msw'
import { setupServer } from '@mokup/msw/node'

const server = setupServer(
  http.get('https://api.example.com/users', () => HttpResponse.json([])),
)
server.listen({ onUnhandledFrame: 'error' })
// Await server.close() in teardown.
```

Install with `pnpm add -D @mokup/msw`. Replace handler-definition imports from `msw`, `msw/node`, and `msw/browser` with the corresponding `@mokup/msw` paths, then recreate those handlers. This is an HTTP migration facade. It also adapts compatible MSW 3 HTTP handler objects when they expose the standard `kind`/`info`/resolver shape.

For MSW 3 HTTP imports, replace `msw/http` with `@mokup/msw`. String `onUnhandledFrame` policies apply to HTTP requests and default to `warn`; `onUnhandledRequest` remains a string alias for MSW 2 migrations. Conflicting aliases are rejected. Generator exhaustion, thrown `Response`, ordinary `once`, and once-generator semantics follow the MSW 3.0.2 HTTP behavior in the compatibility facade. Native `mokup/http` handlers retain Mokup’s finite sequence behavior.

| Area                                                 | Support                                                                                                                                                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP methods and `{ once: true }`                    | Supported using Mokup matching semantics                                                                                                                                                                        |
| Native `Request`, `Response`, `HttpResponse` helpers | Typed params/request/response bodies, `HttpResponse<T>`, and common aliases such as `HttpMethods`, `StrictRequest`, and `HttpResponseResolver` are supported; full MSW type-alias compatibility is not provided |
| `use/resetHandlers/restoreHandlers/listHandlers`     | Supported                                                                                                                                                                                                       |
| `onUnhandledFrame`, `onUnhandledRequest`             | MSW 3 string policy and MSW 2 alias map to native `onUnhandled`; defaults to `warn`                                                                                                                             |
| `setupWorker`                                        | Mokup Service Worker by default; explicit page Fetch/XHR fallback                                                                                                                                               |
| MSW HTTP objects and callback policies               | Supported when the standard MSW HTTP shape is available; unknown startup options and unrelated protocol objects are rejected                                                                                    |
| GraphQL/WebSocket MSW imports and MSW event payloads | Not facade-compatible                                                                                                                                                                                           |

## Reproducible scenarios and CRUD data

```ts
import { createMemoryStore, createScenario } from 'mokup/scenario'

const scenario = createScenario('checkout-42', { authenticated: true })
const users = createMemoryStore([{ id: '1', name: 'Ada' }], 'id')

scenario.update((state) => {
  state.authenticated = false
})
const status = scenario.choose({ success: 200, unavailable: 503 }, 'unavailable')
const nextId = scenario.integer(2, 1000)
users.create({ id: String(nextId), name: 'Grace' })
users.update('1', { name: 'Ada Lovelace' })

const checkpoint = scenario.snapshot()
scenario.random()
scenario.restore(checkpoint) // Restores state and random-generator position.
scenario.reset() // Restores its original state and seed sequence.
users.reset() // The store has its own reset boundary.
```

For named variants and parallel tests, clone the scenarios into a catalog:

```ts
import { createScenario, createScenarioCatalog } from 'mokup/scenario'

const scenarios = createScenarioCatalog({
  happy: createScenario('checkout', { authenticated: true, latency: 0 }),
  unavailable: createScenario('checkout-error', { authenticated: true, latency: 0, status: 503 }),
})
scenarios.compose('slow-unavailable', 'unavailable', 'happy')
scenarios.select('slow-unavailable').update((state) => {
  state.latency = 500
})
const isolated = scenarios.fork() // Safe to mutate in another test or user session.
```

Scenario state and store records must support `structuredClone`. Reads, writes and snapshots are copied; instances do not share state. `update` is synchronous and commits only on success. A catalog clones its input scenarios, `compose` merges object state in layer order, and `fork` clones every named state for an isolated test or user session. Persistence and automatic session identification are not provided. `pick(array)` and unnamed `choose(variants)` use the seeded generator; a named choice does not consume random state.

## Record, redact, replay, and exchange HAR

```ts
import { http } from 'mokup/http'
import { createReplay, exportHar, importHar, recordInteraction } from 'mokup/recording'

const request = new Request('https://api.example.com/users?token=secret')
const response = await fetch(request.clone())
const fixture = await recordInteraction(request, response, {
  maxBodyBytes: 1024 * 1024,
  bodyTimeoutMs: 5000,
  redact: { query: ['token'], jsonPointers: ['/password', '/user/accessToken'] },
})

const har = exportHar([fixture])
const replay = createReplay(importHar(har))
const handler = http.all('*', ({ request }) => replay.handle(request))
// Pass handler to setupServer or setupWorker.
```

Recording reads clones; the original request and response remain consumable. Each body is limited to 1 MiB and 5 seconds by default. Size limits apply before and after JSON redaction. Oversized, unclosed, consumed, or locked bodies fail explicitly. Request cancellation stops both request and response body capture. Infinite streams are not recordable; use `mokup/sse` for streaming mocks.

Authorization, Proxy-Authorization, Cookie, and Set-Cookie are always redacted. Additional header names, query parameters, and JSON Pointer paths are configurable. URL credentials and fragments are removed. JSON pointers apply only to JSON content types; invalid JSON with requested redaction is rejected. Arbitrary text/binary bodies are preserved, not automatically scanned for secrets. Configure all application-specific secrets before saving a fixture. Redacted cookies intentionally cannot reproduce authentication credentials.

Replay matches method, full normalized URL, and exact body bytes after the fixture's redaction rules. It consumes fixtures in input order, `times: 1` by default, and returns `undefined` on a miss. Instances have separate counters. `reset()` restores counters and rejects pending work; `remaining()` reports unused counts. Set `replayTiming: true` to apply the recorded `durationMs`. Replay removes content length, transfer encoding, and content encoding headers because recordings contain the decoded body exposed by Fetch.

HAR response binary data uses standard `content.encoding: 'base64'`. HAR 1.2 has no standard binary request-body encoding, so Mokup uses `postData._encoding: 'base64'` and a `_mokup` extension for repeat/redaction metadata. Text HAR bodies import normally. Unsupported encodings and missing captured bodies fail instead of generating incomplete fixtures. Mokup HAR export/import preserves its binary fixtures and repeat counts; other HAR tools may ignore the extensions.

## Forwarding capture and fixture comparison

Use `createRecordingFetch` when your code explicitly calls a real API. It wraps the supplied forwarding function without installing a listener or replacing global Fetch:

```ts
import { createRecordingFetch } from 'mokup/recording'

const recorder = createRecordingFetch(fetch, {
  maxEntries: 100,
  maxInFlight: 8,
  redact: { query: ['token'], jsonPointers: ['/token', '/password'] },
})
const response = await recorder.fetch('http://127.0.0.1:3000/api/users')
const users = await response.json()
await recorder.flush()
const fixtures = recorder.fixtures()
const issues = recorder.errors()
// Inspect issues before saving fixtures or treating this as a complete capture.
recorder.clear()
```

The forwarding function receives a native `Request`; a supplied Request without overrides is passed through directly. The original response is returned as soon as upstream headers arrive, including error HTTP statuses such as 429. Cloned request and response bodies are recorded in the background with the usual 1 MiB/5 second limits. `durationMs` measures time to response headers, not full-body download time. Forwarding errors propagate to the caller unchanged.

Only complete, successfully redacted fixtures are retained. A recording failure drops that capture and leaves forwarding intact. `errors()` contains only request IDs and fixed code/stage values, never upstream error messages, URLs, headers, or bodies. Its history is bounded by `maxEntries`. Default sensitive-header redaction still applies; query/JSON secrets require the configuration described above.

`maxEntries` bounds retained fixtures plus reservations; `maxInFlight` bounds concurrent captures, including those awaiting upstream headers. Reaching either limit skips recording for that call while still forwarding it; it does not throttle the API. Fixtures are returned as copies in request invocation order. `flush()` waits for currently registered captures; `clear()` drops retained data and cancels pending capture work without cancelling forwarded requests. Use request abort signals to bound upstream waits. The wrapper accepts standard Request/RequestInit semantics, not client-specific options such as an Undici dispatcher.

Compare saved and newly captured interactions with the pure `diffRecordedInteractions` function:

```ts
import type { RecordedFixture } from 'mokup/recording'
import { diffRecordedInteractions } from 'mokup/recording'

function compare(expected: RecordedFixture, actual: RecordedFixture) {
  return diffRecordedInteractions(expected, actual, {
    redact: { headers: ['date', 'x-request-id'], jsonPointers: ['/updatedAt'] },
    maxDifferences: 100,
  })
}
```

The result is `{ equal, differences, truncated }`. Each difference includes a JSON Pointer `path`, `added`/`removed`/`changed` kind, and redacted expected/actual values. JSON bodies compare structurally with paths such as `/response/body/value/id`; object key order is ignored. Non-JSON bodies compare exact bytes, represented as base64. Missing and empty bodies remain distinct.

Comparison merges redaction rules from both fixtures and the supplied options, retaining default sensitive-header masking. Mask dynamic values with `headers`, `query`, or `jsonPointers`; field presence still matters. Recording timestamps/durations, replay counts, and content length/encoding/transfer framing are excluded. Other request/response headers, full normalized URLs, methods, status codes, and status text are compared. Body decoding defaults to 1 MiB per body; malformed JSON and unsupported fixture versions fail explicitly. This function performs no network calls and mutates neither fixture. Automatic traffic discovery, scheduled comparisons, and external persistence remain caller-owned.

For an immediate mock-versus-real check, use `compareLive`. It clones the
request once per side, consumes only bounded response clones, and returns
redacted request data, side errors, fixture-level differences, and optional
OpenAPI response validation:

```ts
import { compareLive } from 'mokup/recording'

const result = await compareLive(request, {
  mock: input => mockSession.handle(input),
  real: input => fetch(`https://api.example.com${new URL(input.url).pathname}`, input),
}, { contract: operation, redact: { query: ['token'] } })

if (!result.equal) {
  console.log(result.diff?.differences, result.contract?.differences)
}
```

`undefined` from the mock side is reported as a bypass, and errors from either
side are diagnostics containing the error message. The original request and returned
responses remain usable because only clones are read. Infinite bodies, locked
bodies, and bodies over the configured limit fail the comparison explicitly.

Live comparison ignores response `Date`, hop-by-hop headers (including fields named by `Connection`), and HTTP status text so transport-generated metadata does not cause false differences. Status codes, application headers, and response bodies still participate. Returned fixtures retain the original transport metadata; `diffRecordedInteractions` continues to compare saved fixtures with its stricter rules.

## OpenAPI contracts and typed handlers

```ts
import { createContract, generateFixture } from 'mokup/contract'

const schema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
  additionalProperties: false,
}
const contract = createContract(schema)
const value = generateFixture(schema)
contract.parse(value) // Throws ContractError with paths and issues on failure.
```

`importOpenApi`, `generateOpenApiFixtures`, and `validateOpenApiResponse` support local OpenAPI 3.0/3.1 JSON contracts. The CLI reads JSON documents and can generate either validated fixtures or a TypeScript module:

```sh
pnpm exec mokup generate --contract openapi.json --out fixtures.json
pnpm exec mokup check --contract openapi.json --fixtures fixtures.json --json
pnpm exec mokup generate --contract openapi.json --format typescript --out mocks.generated.ts
```

Generation refuses to overwrite an existing output. The TypeScript module exports operation-specific request/response body types, `operations`, `fixtures`, and `createHandlers(resolvers)`. Resolver keys use normalized method/path pairs such as `POST /users/:id`. Programmatic generation uses `generateContractSource(document)`.

`createContractHandler(operation, resolver)` bridges an imported operation to a native HTTP handler. The resolver receives parsed `body` alongside the normal request context and returns `{ status, body?, headers? }`. The bridge checks JSON request bodies before resolving, returns explicit 4xx errors for invalid input, and validates the serialized JSON response against its declared status and content type. Invalid mock output throws `ContractError`. Request body reads default to 1 MiB and 5 seconds; serialized responses use the same size limit. Configure these with `maxBodyBytes` and `bodyTimeoutMs`; the timeout does not bound resolver execution. Empty response contracts and 204/205/304 return true bodyless responses.

`createContractCrudHandlers(operations, store)` generates contract-validated
collection/item handlers for `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`. The
store only needs `list/get/create/update/delete`, so a `createMemoryStore` can
be replaced by a database or plugin resource without changing the OpenAPI
operations. IDs remain strings when the path parameter is declared as a string;
pass `idFactory` for deterministic creates.

Imported operations also validate declared query, header, path, and cookie parameters before reading the body. Parsed values are available separately as `context.parameters.query/header/path/cookie`; the original `request`, `params`, and `cookies` are preserved. Header keys in `parameters.header` are lowercase. Generated request/response aliases describe bodies; parameter values use the shared scalar, array, and flat object value types.

| Location | Supported serialization                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| Query    | `form`; scalar values, repeated-key arrays with default `explode: true`, or comma arrays with `explode: false` |
| Header   | `simple`; scalar values or comma arrays; names match without case sensitivity                                  |
| Path     | `simple`; scalar values or comma arrays occupying a complete named path segment                                |
| Cookie   | `form`; scalar values, or comma arrays with explicit `explode: false`                                          |

Types must explicitly be `string`, `number`, `integer`, `boolean`, or arrays of these scalar types, either directly or through a finite local schema reference. Booleans accept `true`/`false`, numbers use finite decimal notation, and integers must be safe JavaScript integers. JSON Schema constraints such as enum, bounds, patterns, formats, and array item constraints apply after decoding. Percent-encoded commas remain item content when a raw query/path/Cookie header is available. Transport-supplied cookies without a raw header are already decoded and cannot retain that distinction.

A missing required parameter returns 400 even when its schema has a default. Defaults apply only to absent optional parameters, are validated at setup, and are cloned per request. Query empty strings need `allowEmptyValue: true` and must still satisfy the schema; they are not replaced by defaults. Repeated scalar query keys are rejected. Parameter errors use paths such as `/parameters/query/page` and do not echo request values. Operation parameters override path-item parameters with the same location/name. OpenAPI's reserved `Accept`, `Content-Type`, and `Authorization` header parameter definitions are ignored; security is declared through `security` and `securitySchemes`. Parameter decoding is enforced by `createContractHandler`; JSON fixture generation/check does not synthesize or execute parameterized HTTP requests.

Flat object parameters and the OpenAPI `deepObject`, `label`, `matrix`, `spaceDelimited`, and `pipeDelimited` serialization styles are decoded before validation. Untyped/nullable union serialization, parameter `content`, `allowReserved: true`, exploded cookie arrays, and external references fail explicitly. API key, HTTP Basic/Bearer, OAuth-style bearer and multipart request contracts are enforced by `createContractHandler`; automated live API differential runs remain outside this JSON bridge. Generated TypeScript types express structural shapes conservatively; unsupported or recursive shapes become `unknown`. Runtime validation enforces constraints that TypeScript cannot represent, and fixture generation fails when it cannot produce a valid value.

## GraphQL, SSE, and WebSocket

`mokup/graphql` provides operation-name handlers and schema execution for HTTP queries/mutations. `createGraphQLHandler` accepts a `resolvers` map keyed by `query.field` or `mutation.field`; each resolver receives parsed arguments and the Mokup request context. `createGraphQLPersistedOperations` generates APQ SHA-256 maps, and `graphql.persisted(...)` resolves requests that send only a persisted hash. `createGraphQLHandler` also accepts that map through `persisted`. `graphql.link('/graphql').subscription(...)` serves GraphQL subscriptions over SSE; `createGraphQLWebSocket` (also exposed as `graphql.websocket`) implements the `graphql-transport-ws` connection, subscribe, next, error, ping and complete messages. `generateGraphQLSource(schema, { operations })` emits SDL, object/input/enum types, root argument types, resolver declarations, a `createHandlers` factory, and an async `createPersistedHandlers` factory that builds the APQ map at runtime. `mokup/sse` provides `eventStream` and `sse` handlers with cancellation cleanup. Service Worker mode lets native browser `EventSource` requests pass through the worker; interceptor mode installs an EventSource facade that parses mocked streams and falls back to the native constructor for bypasses.

For OpenAPI contracts, `mokup generate --contract api.yaml --out fixtures.json` and `mokup check --contract api.yaml --fixtures fixtures.json` accept JSON or YAML. Relative local `$ref` files are resolved before schema validation and generation. HTTP(S) references require the explicit `--allow-network` flag. The runtime contract package still receives a fully parsed object, so browser and Worker bundles do not include a filesystem or YAML loader.

`mokup/ws` provides `ws.link(...)`, connection listeners, client snapshots, broadcast, and optional upstream forwarding/rewrite. Start it separately with `setupWebSocket(...links).start({ onUnhandledConnection: 'error' })` and await its `stop()` in teardown. HTTP `setupServer`/`setupWorker` do not start this controller. Only one WebSocket controller can run per JavaScript realm. It intercepts the global web-standard constructor; a compatible global implementation must be provided if the constructor is unavailable. Imported constructors, other realms, and real handshake/TLS/compression behavior remain outside the mock boundary. See the [WebSocket reference](../reference/websocket).

## Diagnostics, plugins, and Playground history

`createDiagnosticsCollector(source)` from `mokup/diagnostics` records bounded HTTP and protocol events and handler coverage, including unexercised definitions. Pass a session for HTTP coverage, or `{ events: controller.events }` for a protocol-only WebSocket/SSE/GraphQL timeline. Its versioned `snapshot()`/`serialize()` data distinguishes matched handlers from produced mock responses and preserves protocol unhandled reasons. Request IDs connect concurrent events; response resolution does not imply stream consumption, and body contents are never captured.

`createPluginHost(session)` from `mokup/plugin` installs scoped handlers and subscriptions. Plugins register cleanup using `defer` and observe a cancellation signal. Failed installations roll back; disposal removes plugin-owned resources and reports cleanup failures. This is an extension mechanism for trusted code. See the [diagnostics and plugin reference](../reference/extensions).

The Playground provides request history, response diff, handler coverage totals, and MSW/Playwright response export for requests issued from the current Playground UI. Export preserves method/path, status, MIME type, and body; it omits query parameters and request headers. Truncated or failed captures cannot be exported. Server diagnostics are bounded and streamed over the Playground WebSocket; coverage is scoped to the attached HTTP session and does not automatically capture every application transport.

## Vitest/Jest hooks and Playwright routing

Mokup does not import or install a test framework. Pass your framework's hooks explicitly:

```ts
import { setupServer } from 'mokup/node'
import { registerMockHooks } from 'mokup/testing'
import { afterAll, afterEach, beforeAll } from 'vitest'

const server = setupServer()
registerMockHooks({ beforeAll, afterEach, afterAll }, {
  start: () => server.listen({ onUnhandled: 'error' }),
  reset: () => server.resetHandlers(),
  stop: () => server.close(),
})
```

For Storybook, create one preview decorator and keep its controller for preview teardown:

```ts
import { createStorybookDecorator } from 'mokup/testing'

const mocks = createStorybookDecorator({ handlers })
export const decorators = [mocks.decorator]
await mocks.ready
// Call `await mocks.stop()` from the preview environment teardown.
```

Cypress can use the same session inside `cy.intercept`:

```ts
import { createCypressInterceptor } from 'mokup/testing'

const mocks = createCypressInterceptor({ handlers })
cy.intercept('**/*', request => mocks.handle(request))
// Dispose the controller in the suite's after hook.
```

Jest uses the same hook signatures. Startup and cleanup are awaited; failed startup triggers cleanup. Use `resetAfterEach: false` as the third argument only when tests intentionally share state.

For Playwright, prefer a fresh context with `serviceWorkers: 'block'` so a Service Worker cannot hide requests from routing:

```ts
import { http, HttpResponse } from 'mokup/http'
import { attachPlaywright } from 'mokup/testing'

const mocks = await attachPlaywright(context, {
  pattern: '**/api/**',
  handlers: [http.get('/api/users', () => HttpResponse.json([]))],
  onUnhandled: 'error',
})
try {
  // Navigate and exercise the application using your Playwright page.
}
finally {
  await mocks.detach()
}
```

Both BrowserContext and Page satisfy the adapter's structural interface; Playwright is not a runtime dependency. Unmatched requests fall through to other routes when policy permits. `detach` removes only this adapter's callback and disposes its session. Failures abort the request, appear in `errors()`, and make `detach()` reject so teardown cannot hide them.

Playwright fulfillment buffers finite bodies: 1 MiB per request/response and 5 seconds per response by default, configurable with `maxBodyBytes` and `bodyTimeoutMs`. Playwright supplies the request body already buffered. Infinite responses and multiple Set-Cookie fields are rejected explicitly; use a Node/Service Worker transport for those cases. WebSocket routing is not implemented by this adapter.

## Share mocks through Git or npm

Share the existing manifest and bundled handlers as a versioned package; no registry service specific to Mokup is required. In a separate `@team/api-mocks` repository, keep `mock/` under version control and run:

```sh
pnpm exec mokup check --dir mock
pnpm exec mokup build --dir mock --out dist
pnpm pack
```

The package should export the generated bundle and include the entire output, including `mokup-handlers`:

```json
{
  "name": "@team/api-mocks",
  "version": "1.0.0",
  "type": "module",
  "files": ["dist", "index.d.ts"],
  "exports": {
    ".": { "types": "./index.d.ts", "default": "./dist/mokup.bundle.mjs" }
  },
  "peerDependencies": { "mokup": "^3.1.0" }
}
```

For TypeScript consumers, add `index.d.ts`:

```ts
import type { RuntimeOptions } from 'mokup/runtime'

declare const bundle: RuntimeOptions
export default bundle
```

Validate the packed artifact in CI before publishing it to your existing private/public npm registry. Keep any dependencies imported by your handlers declared in the mock package. For Git distribution, commit the generated `dist` into a release tag and pin consumers to that tag or commit; do not depend on mutable branch heads. The same artifact can be installed from a workspace or tarball.

The repository includes a contract smoke test that builds a handler package, runs `npm pack`, installs the tarball in an isolated consumer, imports both package exports, and executes the bundle through `createFetchHandler`:

```sh
pnpm run test:mock-package-contract
```

Consumers install a pinned version, for example `pnpm add -D @team/api-mocks@1.0.0`, and reuse it directly:

```ts
import bundle from '@team/api-mocks'
import { http } from 'mokup/http'
import { setupServer } from 'mokup/node'
import { createFetchHandler } from 'mokup/server/fetch'

const fetchMock = createFetchHandler(bundle)
const server = setupServer(http.all('*', async ({ request }) =>
  (await fetchMock(request)) ?? undefined))
```

The bundle also works with existing Node/Worker adapters. Sharing source through Git and sharing built artifacts through npm are implemented using current tooling; hosted registries, team dashboards, and automatic deployment are separate future work.

## Delivery matrix

Built manifests and scanned file routes compile to shared HTTP definitions with a Hono compatibility adapter. File servers, Vite, Webpack, deployed Fetch/Hono/Worker handlers and native Node middleware expose shared controls and events, including native paths and misses. Sessions survive successful refreshes and close with their server or compiler generation. Failed candidates preserve the served HTTP baseline. Mounted Hono routes have dynamic parent path, context and control tests; the complete transport/edge acceptance matrix remains unfinished.

This table describes capabilities in the current source; package availability follows the release changelog. M0 exit gates remain pending.

| Milestone                         | Implemented                                                                                                                                                                                                                                                                                                                                                          | Still required                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| M0: HTTP test baseline            | Typed HTTP handlers, Node/Service Worker/page interception, lifecycle/once/overrides, `@msw/url` matching, scoped virtual browser cookies, HTTP import facade, framework hooks and Playwright routing                                                                                                                                                                | Full MSW API/object/type-alias compatibility, persistent browser cookies, broader transport/runtime conformance |
| M1: reproducible mocks            | Scenarios/CRUD, bounded recording/replay/HAR, forwarding recorder, fixture diffs and live mock-versus-real comparison, OpenAPI JSON/TypeScript generation and checks, request/response/parameter/security/multipart contract handlers, GraphQL HTTP/APQ/subscriptions over SSE and graphql-transport-ws, browser EventSource support and independent WebSocket mocks | Automatic session persistence, scheduled differential runs                                                      |
| M2: collaboration and diagnostics | File routing/manifests, Git/npm sharing, deployment adapters, HTTP diagnostics/plugin host, Playground request history/diff/handler coverage, and framework adapters                                                                                                                                                                                                 | Application-wide multi-transport timeline, scenario controls, deployment automation, Devframe integration       |

Mokup does not claim feature parity with or superiority to every MSW release. Choose the documented subset and verify it against your project's transports, tests, and deployment targets.
