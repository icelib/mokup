# @mokup/cli

## 2.1.0

### Minor Changes

- Add `mokup check` and `checkManifest()` to validate mock routes without generating build artifacts or starting a server. Support strict diagnostics, structured JSON reports, and actionable failures for missing directories and invalid JSON mock files while preserving existing build behavior.

### Patch Changes

- Keep generated handler and middleware imports aligned with their bundled files when mock directories are outside the project root. Preserve separate outputs for sources with the same filename, retain existing paths for in-project handlers, and report conflicting output names instead of silently replacing an entry.

- Escape generated module imports and handler map keys so paths containing quotes, backslashes, or line breaks preserve their identity in bundles, Service Workers, CLI handler indexes, and Playground HMR scripts.

- Upgrade runtime dependencies, migrate Node WebSocket support to `@hono/node-server` 2, and add Vite 8 peer compatibility.

- Update runtime dependencies and the shared build toolchain to current compatible releases, including stable Rolldown and Vite 8 support. Preserve the published packages' Node.js runtime requirement of `^20.19.0 || >=22.12.0`.

  Migrate repository tooling and release management to repoctl and pnpm 12 native versioning. Development, builds, and CI use Node.js 24 LTS from 24.15.0; TypeScript remains on its latest compatible release line. Integrate the Hono Node server 2.x WebSocket migration while retaining the published Node.js runtime range.

- Updated dependencies:
  - @mokup/runtime@2.1.0
  - @mokup/server@2.0.1
  - @mokup/shared@2.0.1

## 2.0.0

### Major Changes

- 🚀 **Switch all published packages to ESM-only outputs, replace unbuild/tsup-based package builds with tsdown, raise the minimum supported Node.js versions to `^20.19.0 || >=22.12.0`, and rename `@mokup/shared/esbuild` to `@mokup/shared/rolldown`.** [`45ce7ee`](https://github.com/sonofmagic/mokup/commit/45ce7ee79f50ace21a585c1aa5418c2e5f5d0137) by @sonofmagic

### Patch Changes

- 🐛 **Add a repeatable `mokup build --error-on <category>` CLI flag so selected diagnostics can fail manifest builds from the command line.** [`ef1e626`](https://github.com/sonofmagic/mokup/commit/ef1e6262b45211d5fb0325a677058b87c401c44e) by @sonofmagic

- 🐛 **Validate `--error-on` CLI values against the shared diagnostics catalog and keep the help text in sync with supported categories.** [`e182cc4`](https://github.com/sonofmagic/mokup/commit/e182cc4007bc095f95d6aac7d05bdff144ac8c31) by @sonofmagic

- 🐛 **Add repeatable `mokup serve --error-on <category>` support and allow fetch-based server startup to fail on selected route diagnostics.** [`665aa7c`](https://github.com/sonofmagic/mokup/commit/665aa7c51da560ddb5cacb31d5f33ccbf728d33b) by @sonofmagic

- 🐛 **Add `errorOn` diagnostics controls so selected mokup route and service worker diagnostics can fail builds instead of only logging warnings.** [`8cf5d8a`](https://github.com/sonofmagic/mokup/commit/8cf5d8a05cbfa98878c3510bedd4805ceafeefa0) by @sonofmagic

- 🐛 **Add summarized diagnostics for invalid route files and service worker config conflicts during builds and plugin refreshes.** [`f85e89a`](https://github.com/sonofmagic/mokup/commit/f85e89aa991c53538e0adb569f56dba2d2d7faa8) by @sonofmagic
- 📦 **Dependencies** [`326c455`](https://github.com/sonofmagic/mokup/commit/326c455f3fd4d80b2436176c95d9917272e4cec3)
  → `@mokup/shared@2.0.0`, `@mokup/server@2.0.0`, `@mokup/runtime@2.0.0`

## 1.1.6

### Patch Changes

- 📦 **Dependencies**
  → `@mokup/server@1.2.6`

## 1.1.5

### Patch Changes

- 📦 **Dependencies**
  → `@mokup/server@1.2.5`

## 1.1.4

### Patch Changes

- 📦 **Dependencies** [`e97e70d`](https://github.com/sonofmagic/mokup/commit/e97e70df5c8cf67f910b1869ce4cc803a716ec94)
  → `@mokup/shared@1.1.4`, `@mokup/runtime@1.0.9`, `@mokup/server@1.2.4`

## 1.1.3

### Patch Changes

- 📦 **Dependencies**
  → `@mokup/server@1.2.3`

## 1.1.2

### Patch Changes

- 🐛 **Fix ESM type resolution for subpath exports and add a Node moduleResolution fallback.** [`66f1612`](https://github.com/sonofmagic/mokup/commit/66f161228064fb525242f37512842353bd22980d) by @sonofmagic
- 📦 **Dependencies** [`66f1612`](https://github.com/sonofmagic/mokup/commit/66f161228064fb525242f37512842353bd22980d)
  → `@mokup/runtime@1.0.8`, `@mokup/server@1.2.2`, `@mokup/shared@1.1.3`

## 1.1.1

### Patch Changes

- 🐛 **chore: add type test coverage and scripts across packages** [`c2ff07c`](https://github.com/sonofmagic/mokup/commit/c2ff07c213681edce0e26d93e8b7d9df420b6093) by @sonofmagic
- 📦 **Dependencies** [`c2ff07c`](https://github.com/sonofmagic/mokup/commit/c2ff07c213681edce0e26d93e8b7d9df420b6093)
  → `@mokup/runtime@1.0.7`, `@mokup/server@1.2.1`, `@mokup/shared@1.1.2`

## 1.1.0

### Minor Changes

- ✨ **feat: replace defineConfig pre/normal/post with onBeforeAll/onAfterAll hooks and app.use; support async config hooks and hookError policy; add mokupWebpack wrapper and createWebpackPlugin alias for webpack** [`f93b392`](https://github.com/sonofmagic/mokup/commit/f93b3927cd3d86b0cfa9758c0d92523df7bedadc) by @sonofmagic

### Patch Changes

- 📦 **Dependencies** [`f93b392`](https://github.com/sonofmagic/mokup/commit/f93b3927cd3d86b0cfa9758c0d92523df7bedadc)
  → `@mokup/server@1.2.0`

## 1.0.11

### Patch Changes

- 📦 **Dependencies**
  → `@mokup/server@1.1.8`

## 1.0.10

### Patch Changes

- 🐛 **Improve Windows path normalization, module base URL handling, and add cross-platform tests.** [`0477112`](https://github.com/sonofmagic/mokup/commit/047711228c3b831a5418c14418087b5cf7e86c6b) by @sonofmagic
- 📦 **Dependencies** [`33ac588`](https://github.com/sonofmagic/mokup/commit/33ac5886d93789087ff53d3da8cf721ee1e2707b)
  → `@mokup/shared@1.1.1`, `@mokup/server@1.1.7`, `@mokup/runtime@1.0.6`

## 1.0.9

### Patch Changes

- 📦 **Dependencies** [`449e097`](https://github.com/sonofmagic/mokup/commit/449e09742e3a27b021af700d720441e9424fccd2)
  → `@mokup/runtime@1.0.5`, `@mokup/server@1.1.6`

## 1.0.8

### Patch Changes

- 📦 **Dependencies** [`bb0a019`](https://github.com/sonofmagic/mokup/commit/bb0a019d1e9b09ebbde754b2cbf914cca9364f13)
  → `@mokup/shared@1.1.0`, `@mokup/runtime@1.0.4`, `@mokup/server@1.1.5`

## 1.0.7

### Patch Changes

- 📦 **Dependencies**
  → `@mokup/server@1.1.4`

## 1.0.6

### Patch Changes

- 🐛 **refactor: replace before/after middleware positions with pre/normal/post, add defineConfig exports, and introduce defineHandler for route file type hints; update playground middleware display to match.** [`74d29de`](https://github.com/sonofmagic/mokup/commit/74d29de5729b62d96d49ef7bac1dc89b64655f50) by @sonofmagic

- 🐛 **Move consola-backed logger utilities into @mokup/shared and use them across runtime and CLI output.** [`9701b83`](https://github.com/sonofmagic/mokup/commit/9701b838e19e50d46142bcae5ba6fe2aef39bc8b) by @sonofmagic
- 📦 **Dependencies** [`74d29de`](https://github.com/sonofmagic/mokup/commit/74d29de5729b62d96d49ef7bac1dc89b64655f50)
  → `@mokup/server@1.1.3`, `@mokup/shared@1.0.2`, `@mokup/runtime@1.0.3`

## 1.0.5

### Patch Changes

- 🐛 **Make @mokup/server default entry runtime-safe, add node/adapter subpath exports,** [`fd1e240`](https://github.com/sonofmagic/mokup/commit/fd1e240c9d818c20e87954ca3c4a0d40715f07d2) by @sonofmagic
  - and update mokup/server to re-export the Node adapters with a new `mokup/server/fetch` entry for runtime-agnostic handlers. Unify createFetchServer to accept { entries, playground } only. Shared mock option types are now centralized for Vite/webpack and server configs.
- 📦 **Dependencies** [`fd1e240`](https://github.com/sonofmagic/mokup/commit/fd1e240c9d818c20e87954ca3c4a0d40715f07d2)
  → `@mokup/server@1.1.2`, `@mokup/shared@1.0.1`, `@mokup/runtime@1.0.2`

## 1.0.4

### Patch Changes

- 📦 **Dependencies** [`aba183d`](https://github.com/sonofmagic/mokup/commit/aba183d4a9cda9dd1796a10d70e9db32628a733c)
  → `@mokup/server@1.1.1`, `@mokup/runtime@1.0.1`

## 1.0.3

### Patch Changes

- 📦 **Dependencies** [`dd601f9`](https://github.com/sonofmagic/mokup/commit/dd601f990a6546bde5a909cf67990dbbc99fdfa4)
  → `@mokup/server@1.1.0`

## 1.0.2

### Patch Changes

- 🐛 **Add ignore-prefix support, per-route enable toggles, and a playground view for disabled routes.** [`86ea1db`](https://github.com/sonofmagic/mokup/commit/86ea1dbfc8842bc233b20016133d980df3d072f5) by @sonofmagic
- 📦 **Dependencies** [`86ea1db`](https://github.com/sonofmagic/mokup/commit/86ea1dbfc8842bc233b20016133d980df3d072f5)
  → `@mokup/server@1.0.4`

## 1.0.1

### Patch Changes

- 🐛 **Use the Node server helper from @mokup/server/node.** [`1c1edbb`](https://github.com/sonofmagic/mokup/commit/1c1edbb5761d913f3e3f7659da7f1bf4bb361c02) by @sonofmagic
- 📦 **Dependencies** [`182912b`](https://github.com/sonofmagic/mokup/commit/182912bf450a6ea93c93a3ca776d145bd788b5fc)
  → `@mokup/server@1.0.3`

## 1.0.0

### Major Changes

- 🚀 **Rename public mock APIs to HTTP-oriented types and re-export Hono context/middleware names.** [`6b39338`](https://github.com/sonofmagic/mokup/commit/6b39338d0ca8dab02a5d18cc58f174861726f273) by @sonofmagic

### Patch Changes

- 📦 **Dependencies** [`6b39338`](https://github.com/sonofmagic/mokup/commit/6b39338d0ca8dab02a5d18cc58f174861726f273)
  → `@mokup/runtime@1.0.0`, `@mokup/shared@1.0.0`, `@mokup/server@1.0.2`

## 0.3.1

### Patch Changes

- 📦 **Dependencies**
  → `@mokup/server@1.0.1`

## 0.3.0

### Minor Changes

- ✨ **Add a commander-based CLI in @mokup/cli with the new `serve` command, expose the Node dev server from @mokup/server, and have the mokup binary delegate to @mokup/cli.** [`ce04fe9`](https://github.com/sonofmagic/mokup/commit/ce04fe99ce918a3705d2341183adaf84c5d36cd0) by @sonofmagic

### Patch Changes

- 📦 **Dependencies** [`ce04fe9`](https://github.com/sonofmagic/mokup/commit/ce04fe99ce918a3705d2341183adaf84c5d36cd0)
  → `@mokup/server@1.0.0`, `@mokup/shared@0.1.0`, `@mokup/runtime@0.1.1`

## 0.2.0

### Minor Changes

- ✨ **Move the `mokup` CLI binary into `mokup` and keep `@mokup/cli` as API-only.** [`3700230`](https://github.com/sonofmagic/mokup/commit/3700230085f0b17d9022aa3a14fd6f8e558b1e41) by @sonofmagic

## 0.1.0

### Minor Changes

- ✨ **Switch mock handlers to Hono Context, rename RouteRule.response to handler, and remove rule-level url/method overrides for TS/JS mocks.** [`0f73eac`](https://github.com/sonofmagic/mokup/commit/0f73eaca4c02c2d29f8ff386a768fe179da932ac) by @sonofmagic

### Patch Changes

- 📦 **Dependencies** [`0f73eac`](https://github.com/sonofmagic/mokup/commit/0f73eaca4c02c2d29f8ff386a768fe179da932ac)
  → `@mokup/runtime@0.1.0`

## 0.0.1

### Patch Changes

- 🐛 **chore: release updated mokup packages** [`5671d4f`](https://github.com/sonofmagic/mokup/commit/5671d4fa0e25b466b2e135ac8ddf985468d9e1dd) by @sonofmagic
- 📦 **Dependencies** [`5671d4f`](https://github.com/sonofmagic/mokup/commit/5671d4fa0e25b466b2e135ac8ddf985468d9e1dd)
  → `@mokup/runtime@0.0.1`
