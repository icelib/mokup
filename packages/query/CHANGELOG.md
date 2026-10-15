# @mokup/query

## 1.0.1

### Patch Changes

- Preserve native Fetch Request body, init override, cancellation, keepalive, and redirect semantics. Buffer bodies when rewriting Request URLs so binary and multipart payloads remain replayable.

  Preserve Axios base URL paths, absolute URL policy, protocol-relative host checks, and current instance defaults in both the client adapter and query executor. Keep native Axios header values and invalid URL rejection, and correct the Axios type augmentation.

- Return an empty string for successful HEAD requests and HTTP 204/205 responses in the default Fetch executor, including responses with a JSON content type. Preserve HTTP errors, JSON parse errors on ordinary successful responses, and custom transform ownership of response handling.

- Reject non-2xx responses in the default Fetch executor with an exported MokupHttpError that preserves the original, unread Response and exposes its status and statusText. Custom transformResponse handlers continue to control all status handling and response parsing.

  JSON-encode plain object and array request bodies, including null-prototype and cross-realm objects, and add application/json only when Content-Type is absent. Preserve explicit content types and native Fetch body values.

- Update runtime dependencies and the shared build toolchain to current compatible releases, including stable Rolldown and Vite 8 support. Preserve the published packages' Node.js runtime requirement of `^20.19.0 || >=22.12.0`.

  Migrate repository tooling and release management to repoctl and pnpm 12 native versioning. Development, builds, and CI use Node.js 24 LTS from 24.15.0; TypeScript remains on its latest compatible release line. Integrate the Hono Node server 2.x WebSocket migration while retaining the published Node.js runtime range.

- Updated dependencies:
  - @mokup/client@1.0.1

## 1.0.0

### Major Changes

- 🚀 **Switch all published packages to ESM-only outputs, replace unbuild/tsup-based package builds with tsdown, raise the minimum supported Node.js versions to `^20.19.0 || >=22.12.0`, and rename `@mokup/shared/esbuild` to `@mokup/shared/rolldown`.** [`45ce7ee`](https://github.com/sonofmagic/mokup/commit/45ce7ee79f50ace21a585c1aa5418c2e5f5d0137) by @sonofmagic

### Patch Changes

- 📦 **Dependencies** [`45ce7ee`](https://github.com/sonofmagic/mokup/commit/45ce7ee79f50ace21a585c1aa5418c2e5f5d0137)
  → `@mokup/client@1.0.0`

## 0.2.1

### Patch Changes

- 🐛 **Normalize query and mutation requests before passing them to the executor.** [`5f7af81`](https://github.com/sonofmagic/mokup/commit/5f7af8137c0fbcd6a8cef9fb80356129754d5aa3) by @sonofmagic

## 0.2.0

### Minor Changes

- ✨ **add mokup client request switching utilities and tanstack query integration** [`5422d71`](https://github.com/sonofmagic/mokup/commit/5422d7114913347491f0030922362e272e0e5c8c) by @sonofmagic

### Patch Changes

- 🐛 **Fix ESM type resolution for subpath exports and add a Node moduleResolution fallback.** [`66f1612`](https://github.com/sonofmagic/mokup/commit/66f161228064fb525242f37512842353bd22980d) by @sonofmagic
- 📦 **Dependencies** [`5422d71`](https://github.com/sonofmagic/mokup/commit/5422d7114913347491f0030922362e272e0e5c8c)
  → `@mokup/client@0.2.0`
