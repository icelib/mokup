# mokup

## 3.1.0

### Minor Changes

- Add `mokup check` and `checkManifest()` to validate mock routes without generating build artifacts or starting a server. Support strict diagnostics, structured JSON reports, and actionable failures for missing directories and invalid JSON mock files while preserving existing build behavior.

### Patch Changes

- Publish Vite route refreshes atomically after diagnostics, app construction, and route signature generation succeed. Keep the last successful routes, Playground metadata, app, and Service Worker version when a candidate refresh is rejected, while continuing to record diagnostics. Recover first-route Service Worker registration after rejected scans and expose the complete new snapshot before notifying HMR consumers.

- Keep the current page and automatic Service Worker update queue alive when worker runtime entries all use SW mode with server fallback disabled. Avoid redundant full-page reloads for these browser-only updates, while retaining empty-to-nonempty registration bootstrapping and existing refresh behavior for server routes, fallback routes, and manual registration.

- Cancel pending mock refreshes when Webpack watching closes and discard unfinished work from the closed session. Serialize refreshes, publish routes and Service Worker bundles together after successful builds, and restore mock watching when the compiler starts a new watch session. Keep compilation assets and in-flight Service Worker requests tied to their own session snapshots.

  Refresh once after filesystem watching is ready so edits made during its initial scan also reach compiled assets.

- Apply Service Worker lifecycle scripts when opening the dynamic Playground directly in Vite preview. Register the existing built worker independently of current source routes, skip registration when its artifact is missing, and honor the current manual-registration and unregister settings without injecting development-only imports or HMR scripts.

- Escape generated module imports and handler map keys so paths containing quotes, backslashes, or line breaks preserve their identity in bundles, Service Workers, CLI handler indexes, and Playground HMR scripts.

- Preserve Mokup route grammar when registering Hono routes. Numeric, hyphenated, and repeated parameter names no longer break routing, and static colons, wildcards, braces, and pipes match literally. Keep original parameter names available to middleware, mounted apps, and error handlers.

- Upgrade runtime dependencies, migrate Node WebSocket support to `@hono/node-server` 2, and add Vite 8 peer compatibility.

- Resolve Playground build output relative to the Vite project root and avoid duplicating the base prefix on disk. When Playground builds are enabled, preview serves the built HTML, assets, and route snapshot, preserves query parameters when redirecting the mount to its trailing-slash URL, and keeps server mock routes from shadowing that static mount.

- Preserve original request bytes when server adapters reconstruct Fetch requests, fixing binary and multipart file uploads without changing existing parsed body or raw text fields. Runtime requests can provide optional `rawBodyBytes`, which takes precedence over `rawBody` and `body`, including empty byte arrays and sliced buffers.

- Reject non-HTTP URL schemes in Node request targets before matching mock or Playground routes. Return a bad-request error for FTP, WebSocket, file, and other non-HTTP targets while preserving ordinary paths, leading double slashes, and absolute HTTP(S) URLs.

- Keep Service Worker mock responses current when route updates arrive during registration or hot-module reconnects. Listen before registration completes, catch up when the worker becomes available, and release hot-update listeners when their module is disposed.

- Preserve mock updates that arrive while a newer Service Worker is installing alongside an active worker, then refresh the worker after installation finishes.

- Register the Service Worker fetch listener before asynchronous runtime app construction completes. Requests received while handlers or middleware are loading now wait for the runtime promise instead of falling through during the activation window.

- Handle invalid request URLs safely in Vite, preview, and Webpack Service Worker middleware. Return a readable 400 response for malformed URLs and preserve leading double slashes as part of HTTP request paths instead of interpreting them as a hostname.

- Align the built Service Worker file with its registration URL when `sw.path` already includes the complete Vite `base`. Avoid duplicating the base directory so the built application and dynamic Playground can register the worker in preview.

- Update runtime dependencies and the shared build toolchain to current compatible releases, including stable Rolldown and Vite 8 support. Preserve the published packages' Node.js runtime requirement of `^20.19.0 || >=22.12.0`.

  Migrate repository tooling and release management to repoctl and pnpm 12 native versioning. Development, builds, and CI use Node.js 24 LTS from 24.15.0; TypeScript remains on its latest compatible release line. Integrate the Hono Node server 2.x WebSocket migration while retaining the published Node.js runtime range.

- Keep Node mock routes responsive to additions, deletions, and recreation after an empty Vite dev or preview startup. In Vite dev, reload the page to register the Service Worker when the first SW route appears and automatic registration is enabled. Update the worker to an empty route table when all SW routes are removed so requests return to the network.

- Serve the built Service Worker during Vite preview instead of overriding it with unbundled development source. Browser SW registration now works with bundled JSON routes, TypeScript handlers, and middleware under the configured base path, including manual registration. SW mock changes require a rebuild; Node preview route watching remains available.

- Manage mock route refreshes across Vite shutdown and restart: cancel pending watcher work, drain active scans before closing the module loader, and serialize overlapping refresh requests so newer routes cannot be replaced by older scan results.

- Invalidate the generated route bundle in every Vite dev environment so worker runtime mock responses stay current after consecutive file edits.

- Updated dependencies:
  - @mokup/cli@2.1.0
  - @mokup/core@2.0.1
  - @mokup/playground@1.0.1
  - @mokup/runtime@2.1.0
  - @mokup/server@2.0.1
  - @mokup/shared@2.0.1

## 3.0.0

### Major Changes

- 🚀 **Switch all published packages to ESM-only outputs, replace unbuild/tsup-based package builds with tsdown, raise the minimum supported Node.js versions to `^20.19.0 || >=22.12.0`, and rename `@mokup/shared/esbuild` to `@mokup/shared/rolldown`.** [`45ce7ee`](https://github.com/sonofmagic/mokup/commit/45ce7ee79f50ace21a585c1aa5418c2e5f5d0137) by @sonofmagic

### Patch Changes

- 🐛 **Add a repeatable `mokup build --error-on <category>` CLI flag so selected diagnostics can fail manifest builds from the command line.** [`ef1e626`](https://github.com/sonofmagic/mokup/commit/ef1e6262b45211d5fb0325a677058b87c401c44e) by @sonofmagic

- 🐛 **Validate `--error-on` CLI values against the shared diagnostics catalog and keep the help text in sync with supported categories.** [`e182cc4`](https://github.com/sonofmagic/mokup/commit/e182cc4007bc095f95d6aac7d05bdff144ac8c31) by @sonofmagic

- 🐛 **Add repeatable `mokup serve --error-on <category>` support and allow fetch-based server startup to fail on selected route diagnostics.** [`665aa7c`](https://github.com/sonofmagic/mokup/commit/665aa7c51da560ddb5cacb31d5f33ccbf728d33b) by @sonofmagic

- 🐛 **Add `errorOn` diagnostics controls so selected mokup route and service worker diagnostics can fail builds instead of only logging warnings.** [`8cf5d8a`](https://github.com/sonofmagic/mokup/commit/8cf5d8a05cbfa98878c3510bedd4805ceafeefa0) by @sonofmagic

- 🐛 **Add summarized diagnostics for invalid route files and service worker config conflicts during builds and plugin refreshes.** [`f85e89a`](https://github.com/sonofmagic/mokup/commit/f85e89aa991c53538e0adb569f56dba2d2d7faa8) by @sonofmagic
- 📦 Updated 6 dependencies [`ef1e626`](https://github.com/sonofmagic/mokup/commit/ef1e6262b45211d5fb0325a677058b87c401c44e)
  <details><summary>Details</summary>

  `@mokup/cli@2.0.0`, `@mokup/shared@2.0.0`, `@mokup/server@2.0.0`, `@mokup/playground@1.0.0`, `@mokup/core@2.0.0`, `@mokup/runtime@2.0.0`

  </details>

## 2.3.7

### Patch Changes

- 📦 **Dependencies** [`b5ed3d5`](https://github.com/sonofmagic/mokup/commit/b5ed3d5e579db90651f4eecdd18c5eba052f8e93)
  → `@mokup/playground@0.2.3`, `@mokup/server@1.2.6`, `@mokup/cli@1.1.6`

## 2.3.6

### Patch Changes

- 🐛 **Improve e2e stability by hardening Vite readiness checks in `tests/e2e/run-app-e2e.mjs`.** [`45007f6`](https://github.com/sonofmagic/mokup/commit/45007f66158c08455f539dc3b8fb13b70212d2b5) by @sonofmagic
  - Require HTTP readiness to succeed instead of only warning when checks fail.
  - Recover stale Vite lock files when the recorded lock owner process no longer exists.
- 📦 **Dependencies** [`4ac0ea6`](https://github.com/sonofmagic/mokup/commit/4ac0ea67da45620c19616b3fc7b5aa24a2bd3431)
  → `@mokup/playground@0.2.2`, `@mokup/server@1.2.5`, `@mokup/cli@1.1.5`

## 2.3.5

### Patch Changes

- 🐛 **Fix playground SW hot reload for JSON mocks by forcing service worker update on route changes and sending requests with `cache: 'no-store'`.** [`6d7601b`](https://github.com/sonofmagic/mokup/commit/6d7601b55663d7b82c9f3a726463fccaea5295a8) by @sonofmagic

  - Add docs E2E coverage for `mock/example-auth/session.get.json` hot reload, including service worker control checks.

- 🐛 **Fix TS mock hot-reload behavior in SW mode by improving Vite module invalidation and SW module refresh versioning.** [`5b21830`](https://github.com/sonofmagic/mokup/commit/5b218301aa7882752145f121a872612d591945ec) by @sonofmagic
- 📦 Updated 6 dependencies [`e97e70d`](https://github.com/sonofmagic/mokup/commit/e97e70df5c8cf67f910b1869ce4cc803a716ec94)

## 2.3.4

### Patch Changes

- 🐛 **Rename the Vite plugin runtime option to `RuntimeTarget` (`'node' | 'worker'`), change the default to `'node'`, and throw on legacy `runtime: 'vite'`.** [`19a3fbb`](https://github.com/sonofmagic/mokup/commit/19a3fbbb82a839c197a76ded28f42abf8d024cfc) by @sonofmagic
- 📦 Updated 4 dependencies [`b58e7ed`](https://github.com/sonofmagic/mokup/commit/b58e7ed8d427ae907a5c9c511017de0d565a5cd7)

## 2.3.3

### Patch Changes

- 🐛 **Miscellaneous improvements** [`691723f`](https://github.com/sonofmagic/mokup/commit/691723f453baf692dca588cf0f2d329ffaa4acad) by @sonofmagic
  - Register mock middleware before Vite HTML fallback so SPA `/api/*` routes hit mokup.
  - Only inject the SW unregister script when `sw.unregister` is explicitly enabled.

## 2.3.2

### Patch Changes

- 🐛 **Fix ESM type resolution for subpath exports and add a Node moduleResolution fallback.** [`66f1612`](https://github.com/sonofmagic/mokup/commit/66f161228064fb525242f37512842353bd22980d) by @sonofmagic
- 📦 Updated 6 dependencies [`66f1612`](https://github.com/sonofmagic/mokup/commit/66f161228064fb525242f37512842353bd22980d)

## 2.3.1

### Patch Changes

- 🐛 **Miscellaneous improvements** [`4001a06`](https://github.com/sonofmagic/mokup/commit/4001a06f6f1a181f7acb6a001d7261d30c1818f1) by @sonofmagic

  - add the new `@mokup/core` package for shared mokup scanning/manifest utilities
  - force worker runtime reloads when mock routes change so restored jsonc mocks respond correctly

- 🐛 **chore: add type test coverage and scripts across packages** [`c2ff07c`](https://github.com/sonofmagic/mokup/commit/c2ff07c213681edce0e26d93e8b7d9df420b6093) by @sonofmagic
- 📦 Updated 6 dependencies [`4001a06`](https://github.com/sonofmagic/mokup/commit/4001a06f6f1a181f7acb6a001d7261d30c1818f1)

## 2.3.0

### Minor Changes

- ✨ **feat: replace defineConfig pre/normal/post with onBeforeAll/onAfterAll hooks and app.use; support async config hooks and hookError policy; add mokupWebpack wrapper and createWebpackPlugin alias for webpack** [`f93b392`](https://github.com/sonofmagic/mokup/commit/f93b3927cd3d86b0cfa9758c0d92523df7bedadc) by @sonofmagic

### Patch Changes

- 🐛 **Fix Vite worker runtime hot-reload lag by refreshing routes before rebuilding the bundle.** [`b17f49c`](https://github.com/sonofmagic/mokup/commit/b17f49c7e4a219b61e7667407203d7ff1304a4f9) by @sonofmagic

- 🐛 **Fix Vite plugin route refresh to invalidate the worker bundle when mocks are removed and restored, keeping Playground responses in sync.** [`de3f493`](https://github.com/sonofmagic/mokup/commit/de3f493304d47d4f2bde655a208b63db1b7d11a3) by @sonofmagic
- 📦 **Dependencies** [`f93b392`](https://github.com/sonofmagic/mokup/commit/f93b3927cd3d86b0cfa9758c0d92523df7bedadc)
  → `@mokup/cli@1.1.0`, `@mokup/server@1.2.0`

## 2.2.3

### Patch Changes

- 📦 **Dependencies** [`5419fb7`](https://github.com/sonofmagic/mokup/commit/5419fb7bafd892d4557d4a161713c7e6f45a139e)
  → `@mokup/playground@0.0.15`, `@mokup/server@1.1.8`, `@mokup/cli@1.0.11`

## 2.2.2

### Patch Changes

- 🐛 **Improve Windows path normalization, module base URL handling, and add cross-platform tests.** [`0477112`](https://github.com/sonofmagic/mokup/commit/047711228c3b831a5418c14418087b5cf7e86c6b) by @sonofmagic
- 📦 Updated 5 dependencies [`33ac588`](https://github.com/sonofmagic/mokup/commit/33ac5886d93789087ff53d3da8cf721ee1e2707b)

## 2.2.1

### Patch Changes

- 🐛 **Add a cross-platform `mokup/bundle` entry that exposes `buildBundleModule`.** [`1176513`](https://github.com/sonofmagic/mokup/commit/11765138c4a83ac68511884ce32125c30fbc6f08) by @sonofmagic

- 🐛 **Allow explicit undefined for worker bundle module fields to satisfy exactOptionalPropertyTypes.** [`449e097`](https://github.com/sonofmagic/mokup/commit/449e09742e3a27b021af700d720441e9424fccd2) by @sonofmagic
- 📦 Updated 4 dependencies [`449e097`](https://github.com/sonofmagic/mokup/commit/449e09742e3a27b021af700d720441e9424fccd2)

## 2.2.0

### Minor Changes

- ✨ **Add build-time playground output to the mokup Vite plugin and expose a playground build flag.** [`bb0a019`](https://github.com/sonofmagic/mokup/commit/bb0a019d1e9b09ebbde754b2cbf914cca9364f13) by @sonofmagic

### Patch Changes

- 📦 Updated 5 dependencies [`bb0a019`](https://github.com/sonofmagic/mokup/commit/bb0a019d1e9b09ebbde754b2cbf914cca9364f13)

## 2.1.1

### Patch Changes

- 🐛 **Refine Vite playground output formatting and share terminal helpers.** [`58727a9`](https://github.com/sonofmagic/mokup/commit/58727a95de71cb8f4a5eae9d2478d599664c843f) by @sonofmagic

  - Fix playground route config impact typing.

- 🐛 **Fix dev service worker logger import resolution for docs.** [`d7f2c14`](https://github.com/sonofmagic/mokup/commit/d7f2c142d8709997bcdaef9539018d036823800c) by @sonofmagic
- 📦 **Dependencies** [`58727a9`](https://github.com/sonofmagic/mokup/commit/58727a95de71cb8f4a5eae9d2478d599664c843f)
  → `@mokup/playground@0.0.12`, `@mokup/server@1.1.4`, `@mokup/cli@1.0.7`

## 2.1.0

### Minor Changes

- ✨ **Add a Vite virtual bundle module for Worker entries so builds no longer need a generated .mokup bundle.** [`69e852c`](https://github.com/sonofmagic/mokup/commit/69e852c2571d35a4def30b5b7b096c4a07adebc2) by @sonofmagic

### Patch Changes

- 🐛 **Ship built-in type declarations for the `virtual:mokup-bundle` module.** [`69e852c`](https://github.com/sonofmagic/mokup/commit/69e852c2571d35a4def30b5b7b096c4a07adebc2) by @sonofmagic

- 🐛 **refactor: replace before/after middleware positions with pre/normal/post, add defineConfig exports, and introduce defineHandler for route file type hints; update playground middleware display to match.** [`74d29de`](https://github.com/sonofmagic/mokup/commit/74d29de5729b62d96d49ef7bac1dc89b64655f50) by @sonofmagic

- 🐛 **Move consola-backed logger utilities into @mokup/shared and use them across runtime and CLI output.** [`9701b83`](https://github.com/sonofmagic/mokup/commit/9701b838e19e50d46142bcae5ba6fe2aef39bc8b) by @sonofmagic

- 🐛 **Colorize the Mokup Playground URL in Vite dev output and place it after Local/Network.** [`a715a4e`](https://github.com/sonofmagic/mokup/commit/a715a4edddaa2ff056aefe8a9ef2c613667e9d20) by @sonofmagic
- 📦 Updated 5 dependencies [`74d29de`](https://github.com/sonofmagic/mokup/commit/74d29de5729b62d96d49ef7bac1dc89b64655f50)

## 2.0.2

### Patch Changes

- 🐛 **Make @mokup/server default entry runtime-safe, add node/adapter subpath exports,** [`fd1e240`](https://github.com/sonofmagic/mokup/commit/fd1e240c9d818c20e87954ca3c4a0d40715f07d2) by @sonofmagic
  - and update mokup/server to re-export the Node adapters with a new `mokup/server/fetch` entry for runtime-agnostic handlers. Unify createFetchServer to accept { entries, playground } only. Shared mock option types are now centralized for Vite/webpack and server configs.
- 📦 Updated 5 dependencies [`fd1e240`](https://github.com/sonofmagic/mokup/commit/fd1e240c9d818c20e87954ca3c4a0d40715f07d2)

## 2.0.1

### Patch Changes

- 🐛 **fix: add config/ignored distinctions in playground route lists** [`aba183d`](https://github.com/sonofmagic/mokup/commit/aba183d4a9cda9dd1796a10d70e9db32628a733c) by @sonofmagic

- 🐛 **fix: preserve contextual typing for RouteRule handler functions** [`d00d9a8`](https://github.com/sonofmagic/mokup/commit/d00d9a8cf095372c7e10631db34266e9f1e32ae3) by @sonofmagic
- 📦 Updated 4 dependencies [`aba183d`](https://github.com/sonofmagic/mokup/commit/aba183d4a9cda9dd1796a10d70e9db32628a733c)

## 2.0.0

### Major Changes

- 🚀 **refactor: move Vite/webpack plugin config to `{ entries, playground }` and drop legacy entry-shaped input** [`006d219`](https://github.com/sonofmagic/mokup/commit/006d219943db21334fb60818e4e29c2ada896996) by @sonofmagic

### Patch Changes

- 🐛 **Handle Vite watcher relative paths and rename events so mock route changes refresh the playground.** [`06c943f`](https://github.com/sonofmagic/mokup/commit/06c943fa705ad95a43ff112ec6c00517fcf31228) by @sonofmagic
- 📦 **Dependencies** [`dd601f9`](https://github.com/sonofmagic/mokup/commit/dd601f990a6546bde5a909cf67990dbbc99fdfa4)
  → `@mokup/server@1.1.0`, `@mokup/playground@0.0.9`, `@mokup/cli@1.0.3`

## 1.0.4

### Patch Changes

- 🐛 **Add ignore-prefix support, per-route enable toggles, and a playground view for disabled routes.** [`86ea1db`](https://github.com/sonofmagic/mokup/commit/86ea1dbfc8842bc233b20016133d980df3d072f5) by @sonofmagic
- 📦 **Dependencies** [`86ea1db`](https://github.com/sonofmagic/mokup/commit/86ea1dbfc8842bc233b20016133d980df3d072f5)
  → `@mokup/cli@1.0.2`, `@mokup/server@1.0.4`, `@mokup/playground@0.0.8`

## 1.0.3

### Patch Changes

- 📦 **Dependencies** [`1c1edbb`](https://github.com/sonofmagic/mokup/commit/1c1edbb5761d913f3e3f7659da7f1bf4bb361c02)
  → `@mokup/cli@1.0.1`, `@mokup/server@1.0.3`, `@mokup/playground@0.0.7`

## 1.0.2

### Patch Changes

- 🐛 **Fix Vite dev SW lifecycle script to use a resolved module path for `mokup/sw`.** [`5167c7d`](https://github.com/sonofmagic/mokup/commit/5167c7d4fe9d0ec0148998732681f4e4866af47c) by @sonofmagic
- 📦 Updated 5 dependencies [`9cb5835`](https://github.com/sonofmagic/mokup/commit/9cb58357947e1dbe3ec977de7bb07d58c0a8c5be)

## 1.0.1

### Patch Changes

- 📦 **Dependencies** [`a7b9387`](https://github.com/sonofmagic/mokup/commit/a7b9387b48f949a53cc3274f5a461adfdd123894)
  → `@mokup/playground@0.0.5`, `@mokup/server@1.0.1`, `@mokup/cli@0.3.1`

## 1.0.0

### Major Changes

- 🚀 **Add createFetchServer dev API and remove createNodeServer/createMokupServer/startMokupServer.** [`9365bb7`](https://github.com/sonofmagic/mokup/commit/9365bb7f46a515159961a7a51509872e531ceb31) by @sonofmagic

### Minor Changes

- ✨ **Add a commander-based CLI in @mokup/cli with the new `serve` command, expose the Node dev server from @mokup/server, and have the mokup binary delegate to @mokup/cli.** [`ce04fe9`](https://github.com/sonofmagic/mokup/commit/ce04fe99ce918a3705d2341183adaf84c5d36cd0) by @sonofmagic

### Patch Changes

- 📦 Updated 5 dependencies [`ce04fe9`](https://github.com/sonofmagic/mokup/commit/ce04fe99ce918a3705d2341183adaf84c5d36cd0)

## 0.2.2

### Patch Changes

- 📦 **Dependencies** [`0b33818`](https://github.com/sonofmagic/mokup/commit/0b3381872db9852743902019566632331b3ae63c)
  → `@mokup/playground@0.0.4`

## 0.2.1

### Patch Changes

- 📦 **Dependencies** [`a16fd2c`](https://github.com/sonofmagic/mokup/commit/a16fd2cdc1a6157fe238cb3a853ed90f7b107b3b)
  → `@mokup/playground@0.0.3`

## 0.2.0

### Minor Changes

- ✨ **Expose CLI and server adapters via `mokup/cli` and `mokup/server` subpath exports.** [`3700230`](https://github.com/sonofmagic/mokup/commit/3700230085f0b17d9022aa3a14fd6f8e558b1e41) by @sonofmagic

- ✨ **Move the `mokup` CLI binary into `mokup` and keep `@mokup/cli` as API-only.** [`3700230`](https://github.com/sonofmagic/mokup/commit/3700230085f0b17d9022aa3a14fd6f8e558b1e41) by @sonofmagic

- ✨ **Add `mokup/runtime` subpath export and switch SW output to import from it.** [`343b253`](https://github.com/sonofmagic/mokup/commit/343b253f498cb1feadd110e71763273abec67eae) by @sonofmagic

### Patch Changes

- 🐛 **Handle base-prefixed playground paths and ensure the playground middleware runs** [`d2841f1`](https://github.com/sonofmagic/mokup/commit/d2841f17eb7ac16c4a17112737a1caccdd09cac7) by @sonofmagic

  - before static fallbacks.

- 🐛 **Add service worker unregister support and auto-cleanup hooks in the Vite plugin.** [`8de0801`](https://github.com/sonofmagic/mokup/commit/8de08015dcf31759c3aab006a1162e0931576ee6) by @sonofmagic
- 📦 **Dependencies** [`3700230`](https://github.com/sonofmagic/mokup/commit/3700230085f0b17d9022aa3a14fd6f8e558b1e41)
  → `@mokup/cli@0.2.0`, `@mokup/playground@0.0.2`

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
  → `@mokup/runtime@0.0.1`, `@mokup/playground@0.0.1`
