# HTTP handlers and sessions

Import shared HTTP definitions from `mokup/http`. The same definitions work with `setupServer`, `setupWorker`, and a direct `createMockSession`.

```ts
import { createMockSession, http, HttpResponse } from 'mokup/http'

const session = createMockSession(
  http.get('/users/:id', ({ params }) => HttpResponse.json({ id: params.id })),
)

try {
  const response = await session.handle(new Request('https://api.example.test/users/42'))
  console.log(await response?.json())
}
finally {
  await session.dispose()
}
```

`session.handle()` resolves a Fetch `Response`, or `undefined` when the request should reach the real network. A direct session does not perform that network request. Use `passthrough()` to stop matching explicitly; returning `undefined` continues to later handlers.

## Typed request and response bodies

HTTP factories accept `<Params, RequestBody, ResponseBody>` type arguments. Interfaces are supported for params, including `string[]` for repeated parameters. These types describe your contract; they do not validate incoming JSON at runtime. Use contract validation when runtime validation is required.

```ts
import { http, HttpResponse } from 'mokup/http'

interface Params { id: string }
interface Input { name: string }
interface Output { id: string, name: string }

export const updateUser = http.put<Params, Input, Output>(
  '/users/:id',
  async ({ params, request }) => {
    const body = await request.json() // Input
    return HttpResponse.json<Output>({ id: params.id, name: body.name })
  },
)
```

With an explicit response body type, return a typed `HttpResponse`. Without type arguments, native `Response` values remain supported. `HttpResponse.json<T>().json()` returns `Promise<T>`.

## Native file handlers

Use `defineHttpHandler` in a route file to receive standard Fetch objects. The filename supplies the method and path; for example, `mock/users/[id].post.ts`:

```ts
import { defineHttpHandler } from 'mokup'
import { HttpResponse } from 'mokup/http'

export default defineHttpHandler<{ id: string }, { name: string }, { id: string, name: string }>(
  async ({ request, params }) => {
    const body = await request.json()
    return HttpResponse.json({ id: params.id, name: body.name })
  },
  { once: true, headers: { 'x-mock': 'native' } },
)
```

The resolver also receives cookies, requestId, transport context and `finalize`. It supports the same generators, `undefined`, `passthrough()` and `networkError()` as `http.get/post/...`. Existing `defineHandler` files keep their Hono Context and value normalization.

Files can export arrays mixing native and Hono rules. Each rule has its own once and sequence state; consuming one rule continues with the exact next rule, including its own middleware and response overrides. Directory Hono middleware runs on every request and every sequence step. Header-only middleware preserves native fallthrough; an early response or an explicit native post-middleware response supplies a mock. Middleware and a native resolver can independently read the upload body.

Vite, Webpack, CLI bundles and deployed runtimes retain `handlerType: 'http'`, `once` and module rule indexes in the manifest. Generators remain executable modules and are never advanced during builds. `--no-handlers` omits native resolvers. `createRuntimeApp()` exposes `mockSession` for the same controls as file dev servers; dispose that session when the app shuts down.

## Response sequences

A synchronous or asynchronous generator can supply a sequence of responses. Iterator state belongs to each session: reusing one definition in another session or `session.fork()` starts an independent sequence.

```ts
import { delay, http, HttpResponse } from 'mokup/http'

export const job = http.get('/job', async function* ({ request, finalize }) {
  finalize(() => releaseJobResources())
  yield HttpResponse.json({ state: 'pending' })
  await delay(50, { signal: request.signal })
  return HttpResponse.json({ state: 'complete' })
})

function releaseJobResources() {
  // Release resources owned by the sequence.
}
```

- Each matching request advances one step. Concurrent steps are serialized.
- The generator's context is created on its first invocation. Its request, params, and cookies are not replaced for later requests. Use an ordinary resolver when each request needs a fresh context.
- A yielded `undefined` falls through for that request. A final returned response is delivered once; after exhaustion, later handlers can match. The final response is not replayed.
- `{ once: true }` consumes the handler after its first non-`undefined` result. Its iterator closes after that response's resources settle.
- `restoreHandlers()` restores once definitions, preserves ordinary sequence progress, and lets earlier responses finish. `resetHandlers()` restarts sequences and restores the initial definitions, unless replacement definitions are supplied.
- Removing handlers, resetting, or disposing closes their iterators with `.return()`. `dispose()` waits for asynchronous cleanup. Async generators must honor `request.signal` or finish their own pending waits so cleanup can complete.

Ordinary resolver `finalize()` callbacks run when the response stream finishes, is cancelled, or the request/session aborts. Generator callbacks belong to the iterator lifetime; natural completion waits for all yielded and returned response bodies to settle before cleanup. Explicitly closing the iterator aborts its work and releases its resources. Ordinary resolver invocations can run concurrently; sequence advancement is serialized.

## Cookies and transport context

Resolvers receive a `cookies` record. Node requests read the `Cookie` header. Browser transports can supply cookies through session context because browsers prohibit setting a synthetic `Cookie` header:

```ts
await session.handle(request, { cookies: { token: 'from-transport' } })
```

The session copies this record. An explicit request cookie takes priority over a transport cookie with the same name. A direct session does not persist a cookie jar; browser transport ownership and cleanup are described in [Network mocking](../advanced/network-mocking).

Use `HttpResponse` when returning browser mock cookies. It retains cookie metadata even when the browser removes `Set-Cookie` from response headers:

```ts
return HttpResponse.json({ authenticated: true }, {
  headers: [
    ['Set-Cookie', 'session=demo; Path=/; SameSite=Lax'],
    ['Set-Cookie', 'theme=dark; Path=/'],
  ],
})
```

`getResponseCookies(response)` reads this metadata for custom transports. `copyResponseCookies(source, target, overrideHeaders?)` preserves it when rebuilding a response and respects an explicit `Set-Cookie` override. Metadata survives `HttpResponse.clone()`, session streaming, HEAD normalization, and compiled manifest responses. Cookie headers already filtered from an ordinary native `Response` cannot be recovered. JavaScript cannot read real HttpOnly cookies.
