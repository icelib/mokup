# Server Adapters

`mokup/server/node` bundles the Node adapters and dev server helpers. Use
`mokup/server/worker` for Workers or `mokup/server/fetch` for runtime-agnostic fetch handlers.

## Fetch server (Node)

Use cases:

- Start a standalone mock server from local mock files.
- Embed a fetch-capable mock server inside another Node process.

Demo:

```ts
import { createFetchServer, serve } from 'mokup/server/node'

const app = await createFetchServer({
  entries: { dir: 'mock' },
  playground: false,
})
serve({ fetch: app.fetch, port: 3000 })
```

You can call `app.fetch` directly:

Use cases:

- Call the mock server from tests or other server logic without binding a port.

Demo:

```ts
const response = await app.fetch(new Request('http://localhost/api/users'))
```

Call `await app.refresh()` to reload mock files explicitly. Refreshes run one at a time, and requests received during a scan share a follow-up scan. The route table, request handler, and playground metadata switch together after the new snapshot is built successfully; a failed refresh keeps the previous snapshot available.

See [Native module refresh](../advanced/hot-reload.md#native-module-refresh) for entry reload behavior and the limits on refreshing imported helpers.

When file watching is active, `await app.close?.()` stops the watcher, cancels scheduled background refreshes, and waits for active scans to finish. You can still call `app.refresh()` explicitly afterward. Close the HTTP server returned by `serve()` separately when shutting down its listening socket.

## Options

Use cases:

- Provide `moduleMap`/`moduleBase` when running in a sandboxed runtime.
- Choose `onNotFound: 'response'` for a standalone fetch handler that should return 404.

```ts
export interface ServerOptions {
  manifest: Manifest | (() => Promise<Manifest>)
  moduleBase?: string | URL
  moduleMap?: Record<string, Record<string, unknown>>
  onNotFound?: 'next' | 'response'
}
```

`onNotFound` defaults to `'next'`. Use `'response'` to return 404 instead of falling through.

Adapters match the request method and path before reading its body. Mokup does not consume the body of an unmatched request: Node streams remain available to downstream middleware, and an unread Fetch `Request` keeps `bodyUsed === false`. This also applies when `onNotFound` is set to `'response'`.

Custom adapters can perform the same check with [`runtime.hasRoute({ method, path })`](./runtime.md#check-a-route-before-reading-the-request-body) before parsing the body and calling `runtime.handle`.

Node adapters accept path targets and absolute HTTP(S) URLs. Malformed URLs and other schemes, such as `ftp:`, `ws:`, and `file:`, produce a `400` error before routes are loaded or the body is read. Connect and Express pass this error to `next(error)`; Koa and Fastify use their framework error handlers. The development mock and Playground middleware also reject these targets. Leading double slashes remain part of the path.

The Hono adapter runs anywhere Hono can run. Use the Worker entry for Cloudflare Workers.

Demo:

```ts
import type { ServerOptions } from 'mokup/server'
import mokupBundle from './.mokup/mokup.bundle.mjs'

const options: ServerOptions = {
  manifest: mokupBundle.manifest,
  moduleMap: mokupBundle.moduleMap,
  moduleBase: mokupBundle.moduleBase,
  onNotFound: 'response',
}
```

## Prepare manifest

You can load the CLI build output directly:

::: code-group

```bash [pnpm]
pnpm exec mokup build --dir mock --out .mokup
```

```bash [npm]
npm exec mokup build --dir mock --out .mokup
```

```bash [yarn]
yarn mokup build --dir mock --out .mokup
```

```bash [bun]
bunx mokup build --dir mock --out .mokup
```

:::

```ts
import mokupBundle from './.mokup/mokup.bundle.mjs'

const options = {
  manifest: mokupBundle.manifest,
  moduleMap: mokupBundle.moduleMap,
  moduleBase: mokupBundle.moduleBase,
}
```

Pass `options` to any adapter below. For brevity, the examples use `manifest` directly.

## Response cookies

Adapters preserve separate `Set-Cookie` fields from a handler's `Response`, including commas inside `Expires` dates. Node/Express responses use `appendHeader`, Koa uses `append`, and Fastify, Fetch, Hono, and Worker adapters retain the complete cookie list.

Custom Node response objects that implement only `setHeader(name, string)` and custom Koa contexts that implement only `set(Record<string, string>)` keep the legacy scalar behavior: only the last cookie is emitted. Add the optional `appendHeader(name, string)` or `append(name, string)` method to preserve all cookies. Existing required method signatures remain unchanged.

## Express

Use cases:

- Add mock routes into an existing Express app.
- Reuse the same manifest across multiple Express instances.

Demo:

```ts
import { createExpressMiddleware } from 'mokup/server/node'

app.use(createExpressMiddleware({ manifest }))
```

## Connect

Use cases:

- Add mocks to a Connect-based stack or legacy middleware chain.

Demo:

```ts
import { createConnectMiddleware } from 'mokup/server/node'

app.use(createConnectMiddleware({ manifest }))
```

## Koa

Use cases:

- Inject mock routes into a Koa server without rewriting handlers.

Demo:

```ts
import { createKoaMiddleware } from 'mokup/server/node'

app.use(createKoaMiddleware({ manifest }))
```

## Hono

Use cases:

- Mount Mokup inside a Hono app running on Node or edge runtimes.

Demo:

```ts
import { createHonoMiddleware } from 'mokup/server/node'

app.use(createHonoMiddleware({ manifest }))
```

## Fastify

Use cases:

- Plug Mokup into a Fastify server with the standard plugin API.

Demo:

```ts
import { createFastifyPlugin } from 'mokup/server/node'

await app.register(createFastifyPlugin({ manifest }))
```

## Fetch / Worker

Use cases:

- Build a runtime-agnostic fetch handler (Workers, edge, custom servers).
- Combine Mokup routes with your own routing logic.

Demo:

```ts
import { createFetchHandler } from 'mokup/server/fetch'

const handler = createFetchHandler({ manifest })
const response = await handler(new Request('https://example.com/api'))
```

## Worker entry

For Workers (including Cloudflare Workers), use the helper entry. It wraps
`createFetchHandler` from `mokup/server/fetch` and returns a 404 response when
the handler yields `null`:

Use cases:

- Deploy Mokup to Cloudflare Workers with the smallest entry file.
- Avoid manual 404 handling when the mock handler returns `null`.

Demo:

```ts
import { createMokupWorker } from 'mokup/server/worker'
import mokupBundle from 'virtual:mokup-bundle'

export default createMokupWorker(mokupBundle)
```
