# Framework adapters

Mokup's server adapters expose the same Fetch runtime to Next.js, Nuxt/Nitro, and Astro. They have no framework package dependency, so they can be used in application code, tests, and custom runtimes without changing the mock definitions.

## Next.js App Router

Install `mokup` and export the methods from a route module:

```ts
// app/api/[...path]/route.ts
import { createNextRouteHandler } from '@mokup/server/next'

const routes = createNextRouteHandler({
  manifest: { version: 1, routes: [] }, // replace with the generated .mokup manifest
  onNotFound: 'response',
})

export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routes
```

Resolvers receive a standard `Request`. The original Next route context is available through `context.context.next`. `routes.use`, `routes.resetHandlers`, `routes.events`, `routes.selectScenario`, and `routes.close` control the same runtime used by every other adapter.

For Pages Router API routes, use `createNextApiHandler`:

```ts
import { createNextApiHandler } from '@mokup/server/next'

export default createNextApiHandler({ manifest })
```

## Nuxt and Nitro

`createNuxtHandler` accepts both modern Fetch events and Node Nitro events:

```ts
// server/api/[...path].ts
import { createNuxtHandler } from '@mokup/server/nuxt'

export default createNuxtHandler({ manifest, onNotFound: 'response' })
```

The adapter uses `event.request` when Nitro provides it and falls back to `event.node.req`/`event.node.res` on Node deployments. The original event is available through `context.context.nuxt`.

## Astro

Astro endpoint modules can export the generated method table directly:

```ts
// src/pages/api/[...path].ts
import { createAstroEndpoint } from '@mokup/server/astro'

export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = createAstroEndpoint({
  manifest,
  onNotFound: 'response',
})
```

The standard Astro endpoint context is preserved at `context.context.astro`; request matching still uses the original Fetch `Request`.

## Runtime and fallback behavior

All three adapters default to an explicit `404` response when no mock route matches. Set `onNotFound: 'next'` when the host framework supplies a downstream fallback; a route module without a downstream handler still returns `404` after the Mokup handler completes. The adapter controls are isolated per factory call, so parallel tests can create independent sessions.
