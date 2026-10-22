# Optional integrations

Mokup's runtime stays independent from control panels and AI tooling. The
integration packages consume stable snapshots and contracts, so a project can
adopt them gradually without changing its mock handlers.

## Devframe

`createDevframeBridge` exposes diagnostics, handler coverage and scenario
controls through a small structural host interface:

```ts
import { createDevframeBridge } from 'mokup/devframe'

const bridge = createDevframeBridge(server.mockSession)
const disconnect = bridge.connect({
  send: message => panel.postMessage(message),
  onCommand: listener => panel.onMessage(listener),
})

// Keep the host optional. The runtime still works when the panel is absent.
disconnect()
bridge.dispose()
```

The bridge sends a versioned snapshot on connect, lightweight event notices for
the request timeline, and updated snapshots after `scenario.select`,
`scenario.reset`, and `diagnostics.clear` commands. Hosts should treat the
payload as untrusted display data and avoid sending request bodies back into
the runtime.

Pass `{ plugins }` when a plugin host is present to include its discoverable
resource metadata in `snapshot.resources`. Only `kind`, `name`, and plugin name
are exposed; resource values remain inside the plugin host:

```ts
const bridge = createDevframeBridge(server.mockSession, { plugins })
```

## MCP and AI generation

`createMokupMcpServer` implements the transport-neutral MCP JSON-RPC methods
`initialize`, `tools/list`, and `tools/call`. A host may expose it over stdio,
HTTP, or the Devframe bridge without adding an MCP dependency to a browser or
Worker bundle.

For a Fetch-compatible HTTP host, use the built-in adapter. It handles JSON-RPC
notifications with `202`, protocol errors with their standard JSON-RPC body, and
`OPTIONS` preflight requests. Valid JSON-RPC envelopes, including JSON-RPC
errors, use `200`; malformed JSON or an invalid envelope uses `400`:

```ts
import { createMcpHttpHandler, createMokupMcpServer } from 'mokup/mcp'

const mcp = createMcpHttpHandler(createMokupMcpServer(), { cors: true })
export default { fetch: mcp }
```

Node CLI hosts can use the newline-delimited stdio adapter from the dedicated
Node entry. It defaults to `process.stdin` and `process.stdout`, while injected
streams make it straightforward to test or embed:

```ts
import { createMokupMcpServer } from 'mokup/mcp'
import { createMcpStdioServer } from 'mokup/mcp/stdio'

await createMcpStdioServer(createMokupMcpServer()).start()
```

The tools are deliberately reviewable:

- `mokup.inspect` lists normalized operations and response statuses.
- `mokup.generate` returns TypeScript handlers, fixtures, operation metadata,
  and `requiresHumanReview: true`.
- `mokup.validate` returns per-fixture request and response issues and marks an
  invalid result as an MCP tool error.

The generated `structuredContent` is versioned so a panel can render it without
parsing the source text. `mokup.generate` returns `{ schemaVersion: 1, source,
fixtures, operations, review }`; `review` contains `operationCount`,
`fixtureCount`, and `requiresHumanReview: true`. Feed the returned `fixtures`
back into `mokup.validate` before accepting a generated contract. Validation
returns `{ schemaVersion: 1, valid, fixtures }`, where each fixture includes
`request.parameters`, `request.body`, and `response` reports with `valid` and
`issues` fields. This makes generated path/query/header/cookie values and
request bodies visible to a review UI instead of silently trusting generated
examples:

```ts
import type { McpGenerateStructuredContent, McpValidationStructuredContent } from 'mokup/mcp'

const generated = await server.callTool('mokup.generate', { contract })
const generatedContent = generated.structuredContent as McpGenerateStructuredContent
const fixtures = generatedContent.fixtures
const report = await server.callTool('mokup.validate', { contract, fixtures })
const validation = report.structuredContent as McpValidationStructuredContent
if (validation.valid !== true) {
  throw new Error('Review the generated fixtures before publishing them.')
}
```

Pass parsed OpenAPI 3.0/3.1 JSON to the tools. File and network loading stays
in the CLI, where `mokup generate --allow-network` can be governed by CI.

## Deployment templates and package sharing

Runnable examples for Node, Deno, Bun, Cloudflare Workers, Vercel, and Netlify
live under [`examples/deploy`](https://github.com/icelib/mokup/tree/main/examples/deploy).
They all use `createFetchHandler` or `createMokupWorker` and can be replaced by
a generated `mokup` bundle without changing the platform entry point.

For team distribution, publish the generated bundle and manifest in a normal
Git tag or npm package. Keep the package's generated artifact, handler
dependencies, and Mokup version pinned together; run `mokup check --contract`
and a packed consumer smoke test before publishing.
