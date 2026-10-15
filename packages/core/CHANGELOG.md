# @mokup/core

## 2.0.1

### Patch Changes

- Apply 204, 205, and 304 route status overrides without attempting to construct an invalid Fetch response with a body. Cancel discarded response streams, remove payload framing headers from 204 and 205 responses, and retain representation metadata on 304 responses.

- Handle invalid HTTP request URLs without leaving rejected middleware promises and preserve leading double slashes in request paths. Read mock response bodies and validate Node response headers before committing the response so stream or header failures return a complete 500 response without stale content or cookie headers.

- Apply Service Worker lifecycle scripts when opening the dynamic Playground directly in Vite preview. Register the existing built worker independently of current source routes, skip registration when its artifact is missing, and honor the current manual-registration and unregister settings without injecting development-only imports or HMR scripts.

- Escape generated module imports and handler map keys so paths containing quotes, backslashes, or line breaks preserve their identity in bundles, Service Workers, CLI handler indexes, and Playground HMR scripts.

- Execute explicit HEAD routes before falling back to GET across development servers, Connect middleware, Fetch runtimes, and Service Workers. Preserve middleware, response hooks, route parameters, and mounted Hono error handlers while keeping HEAD responses bodyless and HEAD-only routes available for GET fallthrough. Cancel discarded HEAD response streams without losing representation headers such as Content-Length.

- Preserve Mokup route grammar when registering Hono routes. Numeric, hyphenated, and repeated parameter names no longer break routing, and static colons, wildcards, braces, and pipes match literally. Keep original parameter names available to middleware, mounted apps, and error handlers.

- Upgrade runtime dependencies, migrate Node WebSocket support to `@hono/node-server` 2, and add Vite 8 peer compatibility.

- Keep Playground development and preview assets inside the configured distribution directory when resolving symbolic links. Requests that point through an external link now fall through to the next middleware instead of reading files outside the Playground asset root.

- Match Playground mounts at complete path segments so neighboring application routes are not served as Playground assets. Preserve base aliases, correctly apply bases whose names only prefix a path segment, and serve the index, route list, and assets when Playground is mounted at `/`.

  Keep mock routes reachable alongside a root-mounted Playground and register its WebSocket metrics endpoint at `/ws`.

  Preserve `/` as the initialized root mount in the Playground UI so explicitly enabled WebSocket metrics connect to `/ws`, while route requests continue to use `/routes`.

- Protect Playground build output from deleting files outside its configured output directory. Reject paths that normalize to the output root or an ancestor or sibling, and paths through existing symbolic links beneath the output root, before removing or copying any output.

- Resolve Playground build output relative to the Vite project root and avoid duplicating the base prefix on disk. When Playground builds are enabled, preview serves the built HTML, assets, and route snapshot, preserves query parameters when redirecting the mount to its trailing-slash URL, and keeps server mock routes from shadowing that static mount.

- Reject non-HTTP URL schemes in Node request targets before matching mock or Playground routes. Return a bad-request error for FTP, WebSocket, file, and other non-HTTP targets while preserving ordinary paths, leading double slashes, and absolute HTTP(S) URLs.

- Settle request body reads for streams that have already ended or closed, propagate stream errors, and release body buffers and owned listeners when reading finishes.

- Keep Service Worker mock responses current when route updates arrive during registration or hot-module reconnects. Listen before registration completes, catch up when the worker becomes available, and release hot-update listeners when their module is disposed.

- Preserve mock updates that arrive while a newer Service Worker is installing alongside an active worker, then refresh the worker after installation finishes.

- Register the Service Worker fetch listener before asynchronous runtime app construction completes. Requests received while handlers or middleware are loading now wait for the runtime promise instead of falling through during the activation window.

- Update runtime dependencies and the shared build toolchain to current compatible releases, including stable Rolldown and Vite 8 support. Preserve the published packages' Node.js runtime requirement of `^20.19.0 || >=22.12.0`.

  Migrate repository tooling and release management to repoctl and pnpm 12 native versioning. Development, builds, and CI use Node.js 24 LTS from 24.15.0; TypeScript remains on its latest compatible release line. Integrate the Hono Node server 2.x WebSocket migration while retaining the published Node.js runtime range.

- Reuse idle Vite SSR request identities across refreshes instead of adding an entry on every scan. Overlapping loads keep independent requests, successful identities are bounded by each input's peak concurrency, and server restarts and resolution failures retain fresh loading behavior.

- Updated dependencies:
  - @mokup/runtime@2.1.0
  - @mokup/shared@2.0.1

## 2.0.0

### Major Changes

- 🚀 **Switch all published packages to ESM-only outputs, replace unbuild/tsup-based package builds with tsdown, raise the minimum supported Node.js versions to `^20.19.0 || >=22.12.0`, and rename `@mokup/shared/esbuild` to `@mokup/shared/rolldown`.** [`45ce7ee`](https://github.com/sonofmagic/mokup/commit/45ce7ee79f50ace21a585c1aa5418c2e5f5d0137) by @sonofmagic

### Patch Changes

- 🐛 **Add `errorOn` diagnostics controls so selected mokup route and service worker diagnostics can fail builds instead of only logging warnings.** [`8cf5d8a`](https://github.com/sonofmagic/mokup/commit/8cf5d8a05cbfa98878c3510bedd4805ceafeefa0) by @sonofmagic
- 📦 **Dependencies** [`326c455`](https://github.com/sonofmagic/mokup/commit/326c455f3fd4d80b2436176c95d9917272e4cec3)
  → `@mokup/shared@2.0.0`, `@mokup/runtime@2.0.0`

## 1.1.3

### Patch Changes

- 🐛 **Fix playground SW hot reload for JSON mocks by forcing service worker update on route changes and sending requests with `cache: 'no-store'`.** [`6d7601b`](https://github.com/sonofmagic/mokup/commit/6d7601b55663d7b82c9f3a726463fccaea5295a8) by @sonofmagic

  - Add docs E2E coverage for `mock/example-auth/session.get.json` hot reload, including service worker control checks.

- 🐛 **Fix TS mock hot-reload behavior in SW mode by improving Vite module invalidation and SW module refresh versioning.** [`5b21830`](https://github.com/sonofmagic/mokup/commit/5b218301aa7882752145f121a872612d591945ec) by @sonofmagic
- 📦 **Dependencies** [`e97e70d`](https://github.com/sonofmagic/mokup/commit/e97e70df5c8cf67f910b1869ce4cc803a716ec94)
  → `@mokup/shared@1.1.4`, `@mokup/runtime@1.0.9`

## 1.1.2

### Patch Changes

- 🐛 **Rename the Vite plugin runtime option to `RuntimeTarget` (`'node' | 'worker'`), change the default to `'node'`, and throw on legacy `runtime: 'vite'`.** [`19a3fbb`](https://github.com/sonofmagic/mokup/commit/19a3fbbb82a839c197a76ded28f42abf8d024cfc) by @sonofmagic

## 1.1.1

### Patch Changes

- 🐛 **Fix ESM type resolution for subpath exports and add a Node moduleResolution fallback.** [`66f1612`](https://github.com/sonofmagic/mokup/commit/66f161228064fb525242f37512842353bd22980d) by @sonofmagic
- 📦 **Dependencies** [`66f1612`](https://github.com/sonofmagic/mokup/commit/66f161228064fb525242f37512842353bd22980d)
  → `@mokup/runtime@1.0.8`, `@mokup/shared@1.1.3`

## 1.1.0

### Minor Changes

- ✨ **Miscellaneous improvements** [`4001a06`](https://github.com/sonofmagic/mokup/commit/4001a06f6f1a181f7acb6a001d7261d30c1818f1) by @sonofmagic
  - add the new `@mokup/core` package for shared mokup scanning/manifest utilities
  - force worker runtime reloads when mock routes change so restored jsonc mocks respond correctly

### Patch Changes

- 🐛 **chore: add type test coverage and scripts across packages** [`c2ff07c`](https://github.com/sonofmagic/mokup/commit/c2ff07c213681edce0e26d93e8b7d9df420b6093) by @sonofmagic
- 📦 **Dependencies** [`c2ff07c`](https://github.com/sonofmagic/mokup/commit/c2ff07c213681edce0e26d93e8b7d9df420b6093)
  → `@mokup/runtime@1.0.7`, `@mokup/shared@1.1.2`
