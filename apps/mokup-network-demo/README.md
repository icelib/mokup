# Network mocking starter

From the repository root (Node 24 for workspace development):

```sh
pnpm install
pnpm run build:packages
pnpm --filter mokup-network-demo dev
```

The executable example mocks native Fetch, queries GraphQL, switches from a happy
scenario to a 503 response, records a redacted fixture, and replays it. No real API
or account is required. The `finally` block restores network interception.

For browser Service Worker setup, MSW import migration, Vitest/Jest hooks,
Playwright routing, and distributing a reusable Mock package through Git/npm,
see [the network guide](../mokup-docs/docs/advanced/network-mocking.md).

To validate the included OpenAPI contract and generate fixtures:

```sh
pnpm --filter mokup-network-demo exec mokup generate --contract openapi.json --out fixtures.generated.json
pnpm --filter mokup-network-demo exec mokup check --contract openapi.json --fixtures fixtures.generated.json --json
pnpm --filter mokup-network-demo exec mokup generate --contract openapi.json --format typescript --out mocks.generated.ts
```

Generation refuses to overwrite files. Remove your previous generated output or
choose another `--out` filename before running it again. The generated TypeScript
exports typed `createHandlers` that can be passed to Node or browser mocking.
