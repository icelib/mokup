# Runtime API

`mokup/runtime` is the core matcher and response executor.

## createRuntime

Use cases:

- Build a custom fetch adapter or test harness by calling `runtime.handle` directly.
- Run Mokup in environments that do not use Hono (SSR, Workers, integration tests).

Demo:

```ts
import { createRuntime } from 'mokup/runtime'

const runtime = createRuntime({ manifest })
const result = await runtime.handle({
  method: 'GET',
  path: '/users',
  query: {},
  headers: {},
  body: undefined,
})
```

### Check a route before reading the request body

`runtime.hasRoute({ method, path })` returns a `Promise<boolean>` using the same route matching rules as `runtime.handle`. Explicit `HEAD` routes take priority, with `GET` used as a fallback when no `HEAD` route matches.

The query does not execute handlers or middleware, import handler modules, apply delays, or read a request body. It loads and caches the manifest as needed, so the first call may invoke the `manifest` loader supplied in `RuntimeOptions`.

```ts
const matched = await runtime.hasRoute({ method: 'POST', path: '/users' })
```

Custom adapters can use this query before parsing a body, leaving unmatched requests available to downstream handlers. For matched requests, continue calling `runtime.handle` with the complete normalized request shown above. `handle` still returns the mock result or `null` when no route matches.

For matched requests, adapters can provide `rawBodyBytes?: Uint8Array` to preserve binary payloads. The runtime prefers these bytes, including an empty array, over `rawBody?: string` and then the parsed `body`. It copies the supplied byte view, including Buffer slices and SharedArrayBuffer views, before constructing the Fetch request. `GET` and `HEAD` requests remain bodyless.

## Direct usage with CLI bundle

Use the CLI bundle to load a manifest and handler module map in your runtime:

Use cases:

- Run mocks in production runtimes without filesystem access.
- Share a prebuilt bundle across multiple deployments.

Demo:

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
import { createRuntime } from 'mokup/runtime'
import mokupBundle from './.mokup/mokup.bundle.mjs'

const runtime = createRuntime({
  manifest: mokupBundle.manifest,
  moduleMap: mokupBundle.moduleMap,
  moduleBase: mokupBundle.moduleBase,
})
```

If you are not bundling handlers, you can omit `moduleMap` and `moduleBase`.

## createRuntimeApp

Build a Hono app from the manifest (useful for Service Worker or custom fetch handlers).

Use cases:

- Build a fetch handler backed by Mokup routes for Workers or Service Workers.
- Integrate with a Hono-compatible runtime without writing adapters.

Demo:

```ts
import { createRuntimeApp } from 'mokup/runtime'

const app = await createRuntimeApp({ manifest })
const response = await app.fetch(new Request('http://localhost/api/users'))
```

## Service Worker helper

`mokup/runtime` also re-exports `handle` from `hono/service-worker`.

Use cases:

- Wire a Hono app into the Service Worker `fetch` event.
- Keep worker glue code minimal while using Mokup routes.

Demo:

```ts
import { createRuntimeApp, handle } from 'mokup/runtime'

const app = await createRuntimeApp({ manifest })
globalThis.addEventListener('fetch', handle(app))
```

## RuntimeOptions

Use cases:

- Pass a lazy manifest loader to defer bundle loading.
- Provide `moduleMap`/`moduleBase` when your runtime cannot import local files.

```ts
export interface RuntimeOptions {
  manifest: Manifest | (() => Promise<Manifest>)
  moduleBase?: string | URL
  moduleMap?: Record<string, Record<string, unknown>>
}
```

`moduleMap` is required for Worker-like environments where you cannot import local files directly.

Demo:

```ts
import type { RuntimeOptions } from 'mokup/runtime'
import mokupBundle from './.mokup/mokup.bundle.mjs'

const options: RuntimeOptions = {
  manifest: mokupBundle.manifest,
  moduleMap: mokupBundle.moduleMap,
  moduleBase: mokupBundle.moduleBase,
}
```
