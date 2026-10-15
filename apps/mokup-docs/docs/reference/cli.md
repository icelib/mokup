# CLI

`mokup` provides `check`, `build`, and `serve` commands.

## Check

Validate mock routes before committing or in CI, without generating `.mokup` files or starting a server:

```sh
pnpm exec mokup check --dir mock
pnpm exec mokup check --dir mock --json
pnpm exec mokup check --dir mock --error-on duplicate-route
```

`check` uses the same directory configuration, route discovery and filters as `build`. It accepts `--dir`, `--root`, `--prefix`, `--include`, `--exclude`, `--ignore-prefix`, and repeated `--error-on` options. Function handlers count as routes but are not called. Module initialization and directory configuration hooks still run while their files are loaded.

By default, every supported route diagnostic fails the check. Use `--error-on` to fail only selected categories; the report still includes every diagnostic. An existing empty directory, or one with all routes filtered out or disabled, succeeds with zero routes. Missing directories, invalid selected JSON/JSONC files, and module-loading errors fail the check. This command does not perform TypeScript type checking or execute request middleware.

Exit code `0` means the check passed; `1` means diagnostics matched the error policy or scanning failed. `--json` writes a single report to stdout instead of Mokup log messages:

```json
{
  "schemaVersion": 1,
  "valid": true,
  "routeCount": 2,
  "diagnostics": []
}
```

Diagnostic entries include `category`, `label`, `count`, `items`, and optional `advice`. File items use paths relative to the project root. A scanning failure also includes `error.message`, with `valid: false`, `routeCount: 0`, and no diagnostic entries. Keep console output from your own mock modules off stdout when consuming JSON reports.

For programmatic checks:

```ts
import { checkManifest } from 'mokup/cli'

const result = await checkManifest({
  dir: 'mock',
  errorOn: ['duplicate-route'],
})

if (!result.valid) {
  console.error(result.diagnostics)
}
```

`checkManifest()` defaults to `errorOn: 'all'`; `errorOn: []` returns diagnostics without failing on them. It rejects on scanning failures such as missing directories or module import errors. It accepts no output-directory or handler-bundling options.

## Build

Generate `.mokup` outputs for server adapters and workers.

Use cases:

- Generate a bundle for Worker or server runtime deployment.
- Prebuild mock artifacts for CI/CD without running a dev server.

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

### Build options

| Option            | Description                                     |
| ----------------- | ----------------------------------------------- |
| `--dir, -d`       | Mock directory (repeatable)                     |
| `--out, -o`       | Output directory (default: `.mokup`)            |
| `--prefix`        | URL prefix                                      |
| `--include`       | Include regex (repeatable)                      |
| `--exclude`       | Exclude regex (repeatable)                      |
| `--ignore-prefix` | Ignore path segment prefixes (repeatable)       |
| `--error-on`      | Fail build on selected diagnostics (repeatable) |
| `--no-handlers`   | Skip handler output                             |

## Serve

Start a standalone mock server from a directory.

Use cases:

- Spin up a local mock API server without a frontend.
- Validate mock routes with curl or integration tests.

Demo:

::: code-group

```bash [pnpm]
pnpm exec mokup serve --dir mock --prefix /api --port 3000
```

```bash [npm]
npm exec mokup serve --dir mock --prefix /api --port 3000
```

```bash [yarn]
yarn mokup serve --dir mock --prefix /api --port 3000
```

```bash [bun]
bunx mokup serve --dir mock --prefix /api --port 3000
```

:::

### Serve options

| Option            | Description                                       |
| ----------------- | ------------------------------------------------- |
| `--dir, -d`       | Mock directory (repeatable)                       |
| `--prefix`        | URL prefix                                        |
| `--include`       | Include regex (repeatable)                        |
| `--exclude`       | Exclude regex (repeatable)                        |
| `--ignore-prefix` | Ignore path segment prefixes (repeatable)         |
| `--error-on`      | Fail startup on selected diagnostics (repeatable) |
| `--host`          | Hostname (default: `localhost`)                   |
| `--port`          | Port (default: `8080`)                            |
| `--no-watch`      | Disable file watching                             |
| `--no-playground` | Disable Playground                                |
| `--no-log`        | Disable logging                                   |

## API

If you prefer programmatic usage, import `buildManifest`:

Use cases:

- Generate manifests inside Node scripts or build pipelines.
- Integrate Mokup with custom tooling or frameworks.

Demo:

```ts
import { buildManifest } from 'mokup/cli'

await buildManifest({
  dir: 'mock',
  outDir: '.mokup',
  errorOn: ['invalid-route', 'missing-handler'],
})
```

### Strict diagnostics

`buildManifest(...)` supports the same diagnostics control model as the plugin
APIs.

Supported categories:

- `invalid-route`
- `unsupported-fields`
- `missing-handler`
- `duplicate-route`
- `sw-conflict`

Use `errorOn: 'all'` to turn every supported diagnostic into a thrown build
error. In CLI manifest builds, `sw-conflict` is accepted for type parity but only
route-scan diagnostics can currently be emitted.

### Bundle helper (cross-platform)

Generate a bundle module source string without touching the filesystem:

Use cases:

- Build a bundle string in environments without filesystem access.
- Control how module import IDs are emitted for custom runtimes.

Demo:

```ts
import type { RouteTable } from 'mokup/bundle'
import { buildBundleModule } from 'mokup/bundle'

const routes: RouteTable = []
const source = buildBundleModule({
  routes,
  root: '/project',
  resolveModulePath: file => `/virtual/${file}`,
})
```

`routes` uses the same resolved route shape as `scanRoutes` (from `mokup/vite`). Use
`resolveModulePath` to control how module import ids are emitted outside of Vite.

## Notes

- Multiple `--dir` values are merged into one manifest.
- `mokup.bundle.mjs` is the recommended runtime entry.
- `mokup serve` mirrors the standalone server behavior.
