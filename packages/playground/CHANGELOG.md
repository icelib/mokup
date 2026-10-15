# @mokup/playground

## 1.0.1

### Patch Changes

- Upgrade runtime dependencies, migrate Node WebSocket support to `@hono/node-server` 2, and add Vite 8 peer compatibility.

- Match Playground mounts at complete path segments so neighboring application routes are not served as Playground assets. Preserve base aliases, correctly apply bases whose names only prefix a path segment, and serve the index, route list, and assets when Playground is mounted at `/`.

  Keep mock routes reachable alongside a root-mounted Playground and register its WebSocket metrics endpoint at `/ws`.

  Preserve `/` as the initialized root mount in the Playground UI so explicitly enabled WebSocket metrics connect to `/ws`, while route requests continue to use `/routes`.

- Generate executable Fetch snippets and safely quoted cURL commands from Playground requests using the current origin. Preserve query parameters and raw text, correctly encode form fields, and keep text values beginning with `@` from being treated as local file uploads by cURL. Keep the copy menu open when its button is clicked after hovering.

- Build reusable playground assets without loading documentation demo mocks. Keep the demo routes available during development and preview, and remove the build dependency on an already-built mokup package.

- Update runtime dependencies and the shared build toolchain to current compatible releases, including stable Rolldown and Vite 8 support. Preserve the published packages' Node.js runtime requirement of `^20.19.0 || >=22.12.0`.

  Migrate repository tooling and release management to repoctl and pnpm 12 native versioning. Development, builds, and CI use Node.js 24 LTS from 24.15.0; TypeScript remains on its latest compatible release line. Integrate the Hono Node server 2.x WebSocket migration while retaining the published Node.js runtime range.

- Updated dependencies:
  - @mokup/runtime@2.1.0

## 1.0.0

### Major Changes

- 🚀 **Switch all published packages to ESM-only outputs, replace unbuild/tsup-based package builds with tsdown, raise the minimum supported Node.js versions to `^20.19.0 || >=22.12.0`, and rename `@mokup/shared/esbuild` to `@mokup/shared/rolldown`.** [`45ce7ee`](https://github.com/sonofmagic/mokup/commit/45ce7ee79f50ace21a585c1aa5418c2e5f5d0137) by @sonofmagic

### Patch Changes

- 🐛 **Update package dependencies across the playground, server, and shared packages.** [`4b05558`](https://github.com/sonofmagic/mokup/commit/4b05558f27df7e1a8b76474a3b9fbe6958ae7eac) by @sonofmagic
- 📦 **Dependencies** [`45ce7ee`](https://github.com/sonofmagic/mokup/commit/45ce7ee79f50ace21a585c1aa5418c2e5f5d0137)
  → `@mokup/runtime@2.0.0`

## 0.2.3

### Patch Changes

- 🐛 **Improve playground interactions and visual consistency.** [`b5ed3d5`](https://github.com/sonofmagic/mokup/commit/b5ed3d5e579db90651f4eecdd18c5eba052f8e93) by @sonofmagic
  - Use `@floating-ui/dom` for the request "Copy" dropdown and sidebar "More" menu with stable positioning.
  - Keep request header controls at a consistent height for method, URL, copy, and send.
  - Reduce excessive uppercase/tracking styles and fix active chip hover contrast for better readability.

## 0.2.2

### Patch Changes

- 🐛 **Adopt VS Code-style flat UI across all playground components.** [`4ac0ea6`](https://github.com/sonofmagic/mokup/commit/4ac0ea67da45620c19616b3fc7b5aa24a2bd3431) by @sonofmagic
  - Replace rounded-full/2xl/3xl/xl/lg with rounded (2-4px radius).
  - Remove all decorative shadows (shadow-sm/lg/xl) and hover translate effects.
  - Apply VS Code Light+/Dark+ color palette using oklch values.
  - Replace circular drag handle with VS Code-style sash resize zone.
  - Fix duplicate closing tag in PlaygroundSidebar template.

## 0.2.1

### Patch Changes

- 🐛 **Improve playground hot-reload UX by keeping the existing sidebar tree visible while routes refresh, and showing a lightweight in-place loading indicator instead of replacing the tree with a full loading state.** [`246f8ad`](https://github.com/sonofmagic/mokup/commit/246f8ad521c1f425f84109aab2c7a52014645374) by @sonofmagic

  - Add route-state tests to ensure reloads preserve existing list and selection until new data arrives.

- 🐛 **Fix playground SW hot reload for JSON mocks by forcing service worker update on route changes and sending requests with `cache: 'no-store'`.** [`6d7601b`](https://github.com/sonofmagic/mokup/commit/6d7601b55663d7b82c9f3a726463fccaea5295a8) by @sonofmagic

  - Add docs E2E coverage for `mock/example-auth/session.get.json` hot reload, including service worker control checks.

- 🐛 **Improve request editing in playground with a CodeMirror-based editor for query, headers, and body fields.** [`153ff7b`](https://github.com/sonofmagic/mokup/commit/153ff7b9a229c341f44527ea787b336227dc1ab8) by @sonofmagic

  - Load the editor lazily via async component and tab-gated mounting so initial bundle load remains lightweight.

- 🐛 **fix request runner and detail panel backward compatibility for existing responseText and panel storage behavior** [`a86b805`](https://github.com/sonofmagic/mokup/commit/a86b805ee33ded17c097db92b0ae43bbdea9d253) by @sonofmagic

- 🐛 **Improve playground JSON editor UX with a format button and inline parse error line highlighting.** [`4e92362`](https://github.com/sonofmagic/mokup/commit/4e923621068d0eb1d93b1ad7c7860eff306592f6) by @sonofmagic

- 🐛 **Fix TypeScript type issues in playground UI components.** [`b31db52`](https://github.com/sonofmagic/mokup/commit/b31db5289b976b63e20e159b16ab4ca28a2931ba) by @sonofmagic
- 📦 **Dependencies**
  → `@mokup/runtime@1.0.9`

## 0.2.0

### Minor Changes

- ✨ **Update the playground request body editor to Postman-style modes (none, form-data, x-www-form-urlencoded, raw with subtype, binary) with raw JSON validation toggle and binary upload support.** [`67b09a6`](https://github.com/sonofmagic/mokup/commit/67b09a6142120e5c4c9b593d4efb8024558664ff) by @sonofmagic

### Patch Changes

- 🐛 **Align playground request/response UI with Postman-style tabs, fixed method badge sizing, smarter search filters, search term highlighting, and a collapsible sidebar with a collapsed mode rail.** [`b58e7ed`](https://github.com/sonofmagic/mokup/commit/b58e7ed8d427ae907a5c9c511017de0d565a5cd7) by @sonofmagic

## 0.1.1

### Patch Changes

- 📦 **Dependencies** [`66f1612`](https://github.com/sonofmagic/mokup/commit/66f161228064fb525242f37512842353bd22980d)
  → `@mokup/runtime@1.0.8`

## 0.1.0

### Minor Changes

- ✨ **Miscellaneous improvements** [`436a594`](https://github.com/sonofmagic/mokup/commit/436a594564eeaeb650924b3fd60651824c333d9b) by @sonofmagic
  - add multipart file upload rows in the playground request builder

### Patch Changes

- 🐛 **Add a mode indicator in the playground header to show SW vs server handling.** [`c3fde3e`](https://github.com/sonofmagic/mokup/commit/c3fde3ec2f7dd576f658123267b678b25367aedc) by @sonofmagic

- 🐛 **chore: add type test coverage and scripts across packages** [`c2ff07c`](https://github.com/sonofmagic/mokup/commit/c2ff07c213681edce0e26d93e8b7d9df420b6093) by @sonofmagic
- 📦 **Dependencies** [`c2ff07c`](https://github.com/sonofmagic/mokup/commit/c2ff07c213681edce0e26d93e8b7d9df420b6093)
  → `@mokup/runtime@1.0.7`

## 0.0.15

### Patch Changes

- 🐛 **Normalize base64 decode errors to a stable message.** [`5419fb7`](https://github.com/sonofmagic/mokup/commit/5419fb7bafd892d4557d4a161713c7e6f45a139e) by @sonofmagic

## 0.0.14

### Patch Changes

- 🐛 **Persist the last selected API route in the playground, avoid auto-selecting a new route when it is missing, and handle CRLF query inputs.** [`6f79992`](https://github.com/sonofmagic/mokup/commit/6f79992b957d59c3cd0e46ec0274d09ca57bad34) by @sonofmagic

## 0.0.13

### Patch Changes

- 🐛 **Improve the playground request panel with collapsible config/middleware sections, clearer missing-param guidance, and stronger selection cues in the sidebar.** [`ee04bdf`](https://github.com/sonofmagic/mokup/commit/ee04bdfe4ebeaa01321dd7bb1eb29859431ec27f) by @sonofmagic

## 0.0.12

### Patch Changes

- 🐛 **Refine Vite playground output formatting and share terminal helpers.** [`58727a9`](https://github.com/sonofmagic/mokup/commit/58727a95de71cb8f4a5eae9d2478d599664c843f) by @sonofmagic
  - Fix playground route config impact typing.

## 0.0.11

### Patch Changes

- 🐛 **refactor: replace before/after middleware positions with pre/normal/post, add defineConfig exports, and introduce defineHandler for route file type hints; update playground middleware display to match.** [`74d29de`](https://github.com/sonofmagic/mokup/commit/74d29de5729b62d96d49ef7bac1dc89b64655f50) by @sonofmagic

## 0.0.10

### Patch Changes

- 🐛 **fix: add config/ignored distinctions in playground route lists** [`aba183d`](https://github.com/sonofmagic/mokup/commit/aba183d4a9cda9dd1796a10d70e9db32628a733c) by @sonofmagic

## 0.0.9

### Patch Changes

- 🐛 **Improve playground request UI with param-aware inputs, tabbed request sections, real-time URL preview, and shared UI components.** [`08b7d60`](https://github.com/sonofmagic/mokup/commit/08b7d60b1f4ca32b687e0302db950c0ddbb38a17) by @sonofmagic

- 🐛 **Add selectable request body types (JSON, text, form, multipart, base64) to the playground.** [`63a04dc`](https://github.com/sonofmagic/mokup/commit/63a04dc8245d4df3ce792edb6f227d1de4f02450) by @sonofmagic

- 🐛 **Allow opening disabled routes in VSCode and render disabled route paths in lowercase.** [`06c943f`](https://github.com/sonofmagic/mokup/commit/06c943fa705ad95a43ff112ec6c00517fcf31228) by @sonofmagic

## 0.0.8

### Patch Changes

- 🐛 **Add ignore-prefix support, per-route enable toggles, and a playground view for disabled routes.** [`86ea1db`](https://github.com/sonofmagic/mokup/commit/86ea1dbfc8842bc233b20016133d980df3d072f5) by @sonofmagic

## 0.0.7

### Patch Changes

- 🐛 **Add per-route and total request counts to the playground UI.** [`1c1edbb`](https://github.com/sonofmagic/mokup/commit/1c1edbb5761d913f3e3f7659da7f1bf4bb361c02) by @sonofmagic

## 0.0.6

### Patch Changes

- 🐛 **Add stable data-testid hooks for E2E coverage.** [`9cb5835`](https://github.com/sonofmagic/mokup/commit/9cb58357947e1dbe3ec977de7bb07d58c0a8c5be) by @sonofmagic

## 0.0.5

### Patch Changes

- 🐛 **Wait for the mokup service worker to take control before running playground requests.** [`a7b9387`](https://github.com/sonofmagic/mokup/commit/a7b9387b48f949a53cc3274f5a461adfdd123894) by @sonofmagic

## 0.0.4

### Patch Changes

- 🐛 **Enable docs SW registration via env override, expand playground layout to fill the viewport, add a VS Code open shortcut for routes in dev, consolidate playground colors into theme tokens, and fix SW registration injection for built assets.** [`0b33818`](https://github.com/sonofmagic/mokup/commit/0b3381872db9852743902019566632331b3ae63c) by @sonofmagic

## 0.0.3

### Patch Changes

- 🐛 **Fix playground build by ensuring the runtime dependency resolves in CI.** [`a16fd2c`](https://github.com/sonofmagic/mokup/commit/a16fd2cdc1a6157fe238cb3a853ed90f7b107b3b) by @sonofmagic

## 0.0.2

### Patch Changes

- 🐛 **Improve playground layout density, selection visibility, soften the palette, and fix SW runtime resolution in builds.** [`b9ccc59`](https://github.com/sonofmagic/mokup/commit/b9ccc5955abb916fafa0fb27eddaf78537c350a5) by @sonofmagic

## 0.0.1

### Patch Changes

- 🐛 **chore: release updated mokup packages** [`5671d4f`](https://github.com/sonofmagic/mokup/commit/5671d4fa0e25b466b2e135ac8ddf985468d9e1dd) by @sonofmagic
