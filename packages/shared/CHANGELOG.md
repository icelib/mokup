# @mokup/shared

## 2.0.1

### Patch Changes

- Apply 204, 205, and 304 route status overrides without attempting to construct an invalid Fetch response with a body. Cancel discarded response streams, remove payload framing headers from 204 and 205 responses, and retain representation metadata on 304 responses.

- Keep generated handler and middleware imports aligned with their bundled files when mock directories are outside the project root. Preserve separate outputs for sources with the same filename, retain existing paths for in-project handlers, and report conflicting output names instead of silently replacing an entry.

- Execute explicit HEAD routes before falling back to GET across development servers, Connect middleware, Fetch runtimes, and Service Workers. Preserve middleware, response hooks, route parameters, and mounted Hono error handlers while keeping HEAD responses bodyless and HEAD-only routes available for GET fallthrough. Cancel discarded HEAD response streams without losing representation headers such as Content-Length.

- Preserve Mokup route grammar when registering Hono routes. Numeric, hyphenated, and repeated parameter names no longer break routing, and static colons, wildcards, braces, and pipes match literally. Keep original parameter names available to middleware, mounted apps, and error handlers.

- Upgrade runtime dependencies, migrate Node WebSocket support to `@hono/node-server` 2, and add Vite 8 peer compatibility.

- Reload native ESM JavaScript and TypeScript entries independently of clock timing, and refresh CommonJS entries accessed through symbolic links using their resolved module identity.

  Document that native entry refresh preserves cached helper and shared dependency modules, whose changes may require restarting the native server. Vite dev continues to use its module graph invalidation.

- Load and refresh native TypeScript mock and configuration entries in CommonJS and default package scopes with their original exports. Preserve cached dependencies and lazy TypeScript imports, while retaining ESM top-level await and the existing process-wide tsconfig behavior.

- Match global and sticky include/exclude regular expressions independently for each path, preserving the caller's lastIndex so repeated route scans return consistent results.

- Guard request stream failures while adapters await asynchronous route matching, without consuming the body. Preserve original stream errors, reject premature closure, and handle queued destruction errors when handing the request to its next owner.

- Settle request body reads for streams that have already ended or closed, propagate stream errors, and release body buffers and owned listeners when reading finishes.

- Update runtime dependencies and the shared build toolchain to current compatible releases, including stable Rolldown and Vite 8 support. Preserve the published packages' Node.js runtime requirement of `^20.19.0 || >=22.12.0`.

  Migrate repository tooling and release management to repoctl and pnpm 12 native versioning. Development, builds, and CI use Node.js 24 LTS from 24.15.0; TypeScript remains on its latest compatible release line. Integrate the Hono Node server 2.x WebSocket migration while retaining the published Node.js runtime range.

## 2.0.0

### Major Changes

- 🚀 **Switch all published packages to ESM-only outputs, replace unbuild/tsup-based package builds with tsdown, raise the minimum supported Node.js versions to `^20.19.0 || >=22.12.0`, and rename `@mokup/shared/esbuild` to `@mokup/shared/rolldown`.** [`45ce7ee`](https://github.com/sonofmagic/mokup/commit/45ce7ee79f50ace21a585c1aa5418c2e5f5d0137) by @sonofmagic

### Patch Changes

- 🐛 **Export `collectRouteDiagnosticWarning()` so route-scan warning parsing can reuse one shared implementation across mokup packages.** [`326c455`](https://github.com/sonofmagic/mokup/commit/326c455f3fd4d80b2436176c95d9917272e4cec3) by @sonofmagic

- 🐛 **Update package dependencies across the playground, server, and shared packages.** [`4b05558`](https://github.com/sonofmagic/mokup/commit/4b05558f27df7e1a8b76474a3b9fbe6958ae7eac) by @sonofmagic

- 🐛 **Export `diagnosticCategories` and `isDiagnosticCategory()` so runtime diagnostics validation can reuse the shared supported-category list.** [`b8a17fc`](https://github.com/sonofmagic/mokup/commit/b8a17fcdceae0bd56d2f80e8b750ee6bcb627c22) by @sonofmagic

- 🐛 **Export `reportDiagnostics()` to centralize summary logging and strict diagnostic error handling across mokup packages.** [`bd6c228`](https://github.com/sonofmagic/mokup/commit/bd6c2287279f17e95ec539b96276a5f689f23692) by @sonofmagic

- 🐛 **Export `createRouteDiagnosticSections()` so route-scan diagnostics can reuse one shared section builder across mokup packages.** [`add719f`](https://github.com/sonofmagic/mokup/commit/add719fe305b77b43b5f64d854f807141c785841) by @sonofmagic

- 🐛 **Export `collectSwConflictDiagnosticWarning()` and `createSwConflictDiagnosticSections()` so service worker diagnostics can reuse one shared implementation across mokup packages.** [`4f631e6`](https://github.com/sonofmagic/mokup/commit/4f631e6e9ba9b6917c57fc31e86a949aba0e5c42) by @sonofmagic

## 1.1.4

### Patch Changes

- 🐛 **chore: upgrade hono and esbuild** [`e97e70d`](https://github.com/sonofmagic/mokup/commit/e97e70df5c8cf67f910b1869ce4cc803a716ec94) by @sonofmagic

## 1.1.3

### Patch Changes

- 🐛 **Fix ESM type resolution for subpath exports and add a Node moduleResolution fallback.** [`66f1612`](https://github.com/sonofmagic/mokup/commit/66f161228064fb525242f37512842353bd22980d) by @sonofmagic

## 1.1.2

### Patch Changes

- 🐛 **chore: add type test coverage and scripts across packages** [`c2ff07c`](https://github.com/sonofmagic/mokup/commit/c2ff07c213681edce0e26d93e8b7d9df420b6093) by @sonofmagic

## 1.1.1

### Patch Changes

- 🐛 **Add unit coverage for shared path, grouping, and timing helpers.** [`33ac588`](https://github.com/sonofmagic/mokup/commit/33ac5886d93789087ff53d3da8cf721ee1e2707b) by @sonofmagic

- 🐛 **Improve Windows path normalization, module base URL handling, and add cross-platform tests.** [`0477112`](https://github.com/sonofmagic/mokup/commit/047711228c3b831a5418c14418087b5cf7e86c6b) by @sonofmagic

## 1.1.0

### Minor Changes

- ✨ **Add build-time playground output to the mokup Vite plugin and expose a playground build flag.** [`bb0a019`](https://github.com/sonofmagic/mokup/commit/bb0a019d1e9b09ebbde754b2cbf914cca9364f13) by @sonofmagic

## 1.0.2

### Patch Changes

- 🐛 **Move consola-backed logger utilities into @mokup/shared and use them across runtime and CLI output.** [`9701b83`](https://github.com/sonofmagic/mokup/commit/9701b838e19e50d46142bcae5ba6fe2aef39bc8b) by @sonofmagic

## 1.0.1

### Patch Changes

- 🐛 **Make @mokup/server default entry runtime-safe, add node/adapter subpath exports,** [`fd1e240`](https://github.com/sonofmagic/mokup/commit/fd1e240c9d818c20e87954ca3c4a0d40715f07d2) by @sonofmagic
  - and update mokup/server to re-export the Node adapters with a new `mokup/server/fetch` entry for runtime-agnostic handlers. Unify createFetchServer to accept { entries, playground } only. Shared mock option types are now centralized for Vite/webpack and server configs.

## 1.0.0

### Major Changes

- 🚀 **Rename public mock APIs to HTTP-oriented types and re-export Hono context/middleware names.** [`6b39338`](https://github.com/sonofmagic/mokup/commit/6b39338d0ca8dab02a5d18cc58f174861726f273) by @sonofmagic

## 0.1.0

### Minor Changes

- ✨ **Add a shared dependency package and route Hono usage through it.** [`90434e9`](https://github.com/sonofmagic/mokup/commit/90434e978bdab07467e5596c1f4a7567a4cb6c8c) by @sonofmagic
