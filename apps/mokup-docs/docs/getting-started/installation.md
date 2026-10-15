# Installation

## Requirements

- Node.js `>=22.12.0`
- pnpm (recommended)

To contribute to this repository, use Node.js 24 LTS (at least 24.15.0 within the 24.x line) and pnpm 12.8.1. The published packages support the runtime range above.

## Packages

Dev tooling (Vite plugin + CLI):

::: code-group

```bash [pnpm]
pnpm add -D mokup
```

```bash [npm]
npm install -D mokup
```

```bash [yarn]
yarn add -D mokup
```

```bash [bun]
bun add -d mokup
```

:::

Runtime / server adapters (deploy or middleware):

::: code-group

```bash [pnpm]
pnpm add mokup
```

```bash [npm]
npm install mokup
```

```bash [yarn]
yarn add mokup
```

```bash [bun]
bun add mokup
```

:::

If you only need Vite dev mocks, install `mokup` as a dev dependency.

If you are upgrading from an older release, see [Upgrade to v1](/getting-started/upgrade-to-v1).
