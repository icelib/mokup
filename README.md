<p align="center">
  <img src="docs/assets/mokup-logo.svg" width="180" alt="Mokup logo">
</p>
<h1 align="center">mokup</h1>
<p align="center">File-first API mocking for development, tests, browsers, and Workers.</p>
<p align="center">
  <a href="https://mokup.icebreaker.top/">Website</a> ·
  <a href="https://mokup.icebreaker.top/__mokup">Playground</a> ·
  <a href="https://github.com/icelib/mokup">GitHub</a>
</p>

## Why mokup

- File-based routing via filename suffixes like `users.get.json`.
- JSON/JSONC and TS/JS handlers powered by Hono Context.
- Works in Vite dev, CLI builds (workers), and runtime adapters.
- Built-in headers, status, delays, and middleware hooks.
- Native HTTP handlers, Node/Service Worker interception, and test adapters.
- Seeded scenarios, bounded recording/replay with HAR, and OpenAPI contract generation.
- HTTP GraphQL, SSE, independent WebSocket mocks, and session diagnostics/plugins.
- Optional Devframe diagnostics bridge, reviewable MCP contract generation, and
  Node/Deno/Bun/edge deployment templates.

## Requirements

- Node.js `>=22.12.0`

## Upgrade Notes

- Published packages are ESM-only. CommonJS `require()` is no longer supported.
- Internal build packages now use `tsdown` on top of Rolldown.
- Shared build helpers are exposed from `@mokup/shared/rolldown`.

## Quick start

Create `mock/users.get.json`:

```json
{ "ok": true }
```

Create `mock/login.post.ts`:

```ts
export default async (c) => {
  const body = await c.req.json().catch(() => ({}))
  return { ok: true, user: body }
}
```

Tip: you can use `defineHandler` for better IntelliSense:

```ts
import { defineHandler } from 'mokup'

export default defineHandler(async (c) => {
  const body = await c.req.json().catch(() => ({}))
  return { ok: true, user: body }
})
```

Follow the docs at https://mokup.icebreaker.top/ for Vite and CLI setup.
Upgrade details: [docs/guide/migration-v1.md](docs/guide/migration-v1.md)

## Five-minute HTTP test

Install with `pnpm add -D mokup`, save this as `mock-demo.mjs`, and run `node mock-demo.mjs`:

```js
import { http, HttpResponse } from 'mokup/http'
import { setupServer } from 'mokup/node'

const server = setupServer(
  http.get('https://api.example.com/users/:id', ({ params }) =>
    HttpResponse.json({ id: params.id, name: 'Ada' })),
)

server.listen({ onUnhandled: 'error' })
try {
  console.log(await (await fetch('https://api.example.com/users/1')).json())
}
finally {
  await server.close()
}
```

No mock port or application HTTP client wrapper is required. Use `server.use(...)` for temporary overrides, `{ once: true }` for one response, and `server.resetHandlers()` after each test. The separate `mokup/browser` entry provides `setupWorker`, using Mokup's Service Worker asset by default or explicit `mode: 'interceptor'` for page Fetch/XHR. Existing Vite/Webpack SW mode remains available for file routes.

String matching uses `@msw/url` with optional/splat parameters and host/path wildcards; browser relative masks resolve against the page, while Node relative masks match any origin. Browser mocks support scoped, in-memory cookies through `HttpResponse` Set-Cookie and resolver `cookies`, honoring credentials, Domain/Path, expiry, Secure and SameSite without writing real browser cookies.

## Migrating HTTP imports from MSW

`@mokup/msw` is an import-level HTTP migration facade. Install with `pnpm add -D @mokup/msw`, then change HTTP handler-definition imports from `msw` to `@mokup/msw`, and lifecycle imports from `msw/node` or `msw/browser` to the corresponding `@mokup/msw` entry. It maps MSW 3's string `onUnhandledFrame` policies, and MSW 2's `onUnhandledRequest` alias, to Mokup's `onUnhandled` option; the facade defaults to `warn`.

Recreate the handlers after changing imports. Typed params/request/response bodies, `HttpResponse<T>`, and common aliases such as `HttpMethods`, `StrictRequest`, and `HttpResponseResolver` are supported; complete MSW type aliases/event payloads, `bypass(request)`, GraphQL/WebSocket imports, and MSW's worker script are not compatible. The browser facade accepts Mokup `mode` and `serviceWorker` options. Unsupported start options fail explicitly. See the [compatibility table](packages/msw/README.md) and [network mocking guide](https://mokup.icebreaker.top/advanced/network-mocking).

## Delivery matrix

The matrix describes current source capabilities; release availability follows the package changelogs. M0 exit gates remain pending; this is not a claim of full MSW parity.

Built manifests and scanned file routes compile to shared HTTP definitions with a Hono compatibility adapter. File servers, Vite, Webpack, deployed Fetch/Hono/Worker handlers and native Node middleware share session controls and lifecycle events, including native paths and misses. Successful refreshes preserve temporary overrides; failed scans or builds preserve the previous baseline. Node middleware retains request bytes for downstream passthrough and streams responses with backpressure. Remaining integration and acceptance work is tracked in [ROADMAP.md](./ROADMAP.md).

| Milestone           | Available                                                                                                                                                                                                                                                                                                    | Remaining                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| M0: HTTP tests      | Typed handlers/responses, Node/Service Worker/page interception, lifecycle/once/overrides, `@msw/url` matching, scoped virtual browser cookies, HTTP import facade, Vitest/Jest hooks and Playwright adapter                                                                                                 | Full MSW API/object/type-alias compatibility, persistent browser cookies; broader transport/runtime conformance |
| M1: reproducibility | Seeded scenarios, isolated CRUD store, contract-generated CRUD over pluggable storage, bounded recording/replay/HAR, forwarding recorder and fixture diffs, OpenAPI JSON/TypeScript generation and checks, request/response/parameter contract handlers, HTTP GraphQL, SSE, independent WebSocket controller | Automatic session persistence, automated differential runs, richer schema-specific fixtures                     |
| M2: collaboration   | File routing, manifests, Git/npm artifact sharing, deployment adapters, HTTP diagnostics and plugin host, Playground request history/diff, optional Devframe bridge, reviewable MCP tools with HTTP and Node stdio hosts, Node/Deno/Bun/edge templates, and a provider adapter matrix smoke gate             | Application-wide timeline UI, richer MCP review UI, and complete plugin ecosystem                               |

The Playground history, response diff, and MSW/Playwright response export cover requests sent through the current Playground UI. Export keeps method/path, status, MIME type, and body, omits query parameters/request headers, and is disabled for truncated or failed captures. The separate diagnostics collector observes HTTP session events and handler coverage; it is not wired into a global application timeline. WebSocket mocking has its own `setupWebSocket(...).start()/stop()` lifecycle. See the [runnable network starter](apps/mokup-network-demo/README.md), [WebSocket reference](https://mokup.icebreaker.top/reference/websocket), and [diagnostics/plugin reference](https://mokup.icebreaker.top/reference/extensions).

Recording is limited to finite bodies (1 MiB and 5 seconds per body by default), uses configurable redaction, and rejects incomplete captures. Browser page interception covers Fetch/XHR rather than navigation, subresources, EventSource, or separate workers. More examples and boundaries: [English](https://mokup.icebreaker.top/advanced/network-mocking) · [中文](https://mokup.icebreaker.top/zh/advanced/network-mocking).

## Contributing

Repository development requires Node.js `>=24.22.1 <25` and the pnpm version pinned in `package.json`.

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

CI uses Node.js 24.22.1, and shared repository tooling uses repoctl 6 with native Lefthook hooks. Published packages retain the runtime requirement listed above. Create release intents with `pnpm change` and preview them with `pnpm exec repo release plan`.

Nightly packages use the `snapshot-nightly` npm tag. The [preview website](https://next.mokup.icebreaker.top/) follows `main`; the [official website](https://mokup.icebreaker.top/) follows completed stable releases. See [repoctl maintenance](docs/maintenance/repoctl.md) for release, deployment and hook setup.

### Development Checks

- `pnpm run validate:fast`
- `pnpm run guard:migration`
- `pnpm run typecheck:fast`
- `pnpm run lint:lines:guard`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:e2e:serial`

## Contributors

Thanks to [all contributors](https://github.com/icelib/mokup/graphs/contributors)!

## Authors

ice breaker <hi@sonofmagic.top>

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
