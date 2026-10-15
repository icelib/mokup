# @mokup/runtime

## 2.1.0

### Minor Changes

- Add `runtime.hasRoute({ method, path })` so adapters can check route ownership before consuming a request body. Preserve the same method, HEAD fallback, and path priorities as `runtime.handle`, and share one cached manifest across concurrent checks and requests while allowing failed manifest loads to retry.

### Patch Changes

- Apply 204, 205, and 304 route status overrides without attempting to construct an invalid Fetch response with a body. Cancel discarded response streams, remove payload framing headers from 204 and 205 responses, and retain representation metadata on 304 responses.

- Execute explicit HEAD routes before falling back to GET across development servers, Connect middleware, Fetch runtimes, and Service Workers. Preserve middleware, response hooks, route parameters, and mounted Hono error handlers while keeping HEAD responses bodyless and HEAD-only routes available for GET fallthrough. Cancel discarded HEAD response streams without losing representation headers such as Content-Length.

- Preserve Mokup route grammar when registering Hono routes. Numeric, hyphenated, and repeated parameter names no longer break routing, and static colons, wildcards, braces, and pipes match literally. Keep original parameter names available to middleware, mounted apps, and error handlers.

- Preserve original request bytes when server adapters reconstruct Fetch requests, fixing binary and multipart file uploads without changing existing parsed body or raw text fields. Runtime requests can provide optional `rawBodyBytes`, which takes precedence over `rawBody` and `body`, including empty byte arrays and sliced buffers.

- Preserve multiple Set-Cookie fields in optional runtime response metadata, retain binary bytes for media types such as WebAssembly and fonts, and apply response status overrides safely for bodyless statuses.

- Update runtime dependencies and the shared build toolchain to current compatible releases, including stable Rolldown and Vite 8 support. Preserve the published packages' Node.js runtime requirement of `^20.19.0 || >=22.12.0`.

  Migrate repository tooling and release management to repoctl and pnpm 12 native versioning. Development, builds, and CI use Node.js 24 LTS from 24.15.0; TypeScript remains on its latest compatible release line. Integrate the Hono Node server 2.x WebSocket migration while retaining the published Node.js runtime range.

- Updated dependencies:
  - @mokup/shared@2.0.1

## 2.0.0

### Major Changes

- 🚀 **Switch all published packages to ESM-only outputs, replace unbuild/tsup-based package builds with tsdown, raise the minimum supported Node.js versions to `^20.19.0 || >=22.12.0`, and rename `@mokup/shared/esbuild` to `@mokup/shared/rolldown`.** [`45ce7ee`](https://github.com/sonofmagic/mokup/commit/45ce7ee79f50ace21a585c1aa5418c2e5f5d0137) by @sonofmagic

### Patch Changes

- 📦 **Dependencies** [`326c455`](https://github.com/sonofmagic/mokup/commit/326c455f3fd4d80b2436176c95d9917272e4cec3)
  → `@mokup/shared@2.0.0`

## 1.0.9

### Patch Changes

- 📦 **Dependencies** [`e97e70d`](https://github.com/sonofmagic/mokup/commit/e97e70df5c8cf67f910b1869ce4cc803a716ec94)
  → `@mokup/shared@1.1.4`

## 1.0.8

### Patch Changes

- 🐛 **Fix ESM type resolution for subpath exports and add a Node moduleResolution fallback.** [`66f1612`](https://github.com/sonofmagic/mokup/commit/66f161228064fb525242f37512842353bd22980d) by @sonofmagic
- 📦 **Dependencies** [`66f1612`](https://github.com/sonofmagic/mokup/commit/66f161228064fb525242f37512842353bd22980d)
  → `@mokup/shared@1.1.3`

## 1.0.7

### Patch Changes

- 🐛 **chore: add type test coverage and scripts across packages** [`c2ff07c`](https://github.com/sonofmagic/mokup/commit/c2ff07c213681edce0e26d93e8b7d9df420b6093) by @sonofmagic
- 📦 **Dependencies** [`c2ff07c`](https://github.com/sonofmagic/mokup/commit/c2ff07c213681edce0e26d93e8b7d9df420b6093)
  → `@mokup/shared@1.1.2`

## 1.0.6

### Patch Changes

- 🐛 **Improve Windows path normalization, module base URL handling, and add cross-platform tests.** [`0477112`](https://github.com/sonofmagic/mokup/commit/047711228c3b831a5418c14418087b5cf7e86c6b) by @sonofmagic
- 📦 **Dependencies** [`33ac588`](https://github.com/sonofmagic/mokup/commit/33ac5886d93789087ff53d3da8cf721ee1e2707b)
  → `@mokup/shared@1.1.1`

## 1.0.5

### Patch Changes

- 🐛 **Allow explicit undefined for worker bundle module fields to satisfy exactOptionalPropertyTypes.** [`449e097`](https://github.com/sonofmagic/mokup/commit/449e09742e3a27b021af700d720441e9424fccd2) by @sonofmagic

## 1.0.4

### Patch Changes

- 📦 **Dependencies** [`bb0a019`](https://github.com/sonofmagic/mokup/commit/bb0a019d1e9b09ebbde754b2cbf914cca9364f13)
  → `@mokup/shared@1.1.0`

## 1.0.3

### Patch Changes

- 📦 **Dependencies** [`9701b83`](https://github.com/sonofmagic/mokup/commit/9701b838e19e50d46142bcae5ba6fe2aef39bc8b)
  → `@mokup/shared@1.0.2`

## 1.0.2

### Patch Changes

- 📦 **Dependencies** [`fd1e240`](https://github.com/sonofmagic/mokup/commit/fd1e240c9d818c20e87954ca3c4a0d40715f07d2)
  → `@mokup/shared@1.0.1`

## 1.0.1

### Patch Changes

- 🐛 **fix: preserve contextual typing for RouteRule handler functions** [`d00d9a8`](https://github.com/sonofmagic/mokup/commit/d00d9a8cf095372c7e10631db34266e9f1e32ae3) by @sonofmagic

## 1.0.0

### Major Changes

- 🚀 **Rename public mock APIs to HTTP-oriented types and re-export Hono context/middleware names.** [`6b39338`](https://github.com/sonofmagic/mokup/commit/6b39338d0ca8dab02a5d18cc58f174861726f273) by @sonofmagic

### Patch Changes

- 📦 **Dependencies** [`6b39338`](https://github.com/sonofmagic/mokup/commit/6b39338d0ca8dab02a5d18cc58f174861726f273)
  → `@mokup/shared@1.0.0`

## 0.1.1

### Patch Changes

- 🐛 **Add a shared dependency package and route Hono usage through it.** [`90434e9`](https://github.com/sonofmagic/mokup/commit/90434e978bdab07467e5596c1f4a7567a4cb6c8c) by @sonofmagic
- 📦 **Dependencies** [`90434e9`](https://github.com/sonofmagic/mokup/commit/90434e978bdab07467e5596c1f4a7567a4cb6c8c)
  → `@mokup/shared@0.1.0`

## 0.1.0

### Minor Changes

- ✨ **Switch mock handlers to Hono Context, rename RouteRule.response to handler, and remove rule-level url/method overrides for TS/JS mocks.** [`0f73eac`](https://github.com/sonofmagic/mokup/commit/0f73eaca4c02c2d29f8ff386a768fe179da932ac) by @sonofmagic

## 0.0.1

### Patch Changes

- 🐛 **chore: release updated mokup packages** [`5671d4f`](https://github.com/sonofmagic/mokup/commit/5671d4fa0e25b466b2e135ac8ddf985468d9e1dd) by @sonofmagic
