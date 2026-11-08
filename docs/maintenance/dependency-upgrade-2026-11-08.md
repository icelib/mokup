# Dependency Upgrade Report: 2026-11-08

## Scope

Updated workspace dependencies to the latest stable releases within the declared compatible ranges. The toolchain includes repoctl 6.4.4, ESLint 10.14, Stylelint 18, Vite 8.3.6, Vue 3.5.45, Tailwind CSS 4.3.5, Cloudflare Vite plugin 1.67, Wrangler 4.158, tsdown 0.23.7, and current compatible Playwright, Webpack, Hono, Axios, Better Auth, and CodeMirror releases. Node 24.22.1, pnpm 12.11.2, TypeScript 6, Node types 24, Rolldown 1.2.14, the reviewed Vite/VitePress pins, and `@mswjs/interceptors` remain on their reviewed lines.

The frozen lockfile install passes. repoctl's 6.0.1 patch is no longer needed: versioned release-plan validation, workspace peer handling, isolated TypeScript consumer checks, runtime assets, and independent state-branch initialization are present in 6.4.4 and covered by the installed-tool tests.

## Security

Overrides were refreshed to use official fixes within parent ranges, including `body-parser` 2.4, `qs` 6.16.1, `undici` 6.29.1/7.30.1/8.12.2, `serialize-javascript` 7.1.3, `fast-uri` 3.1.9/4.2.3, and `follow-redirects` 1.16.2. The current audit retains three advisories: deepmerge 4.3.1 (low; no installable fix), glob 11.1.0 and 13.0.6 (moderate; patched 14.0.2 crosses parent major ranges), and minimatch 10.2.6 (moderate; patched 11.0.1 crosses parent major ranges). Details, trigger conditions, paths, and review commands are in [Dependency Security Maintenance](dependency-security.md).

## Validation

- `pnpm install --frozen-lockfile`: passed.
- `pnpm peers check`: passed.
- `pnpm run test:release-tools`: 38 tests passed against repoctl 6.4.4.
- `pnpm run test:repoctl-workflows`: 8 tests passed.
- `pnpm exec repo doctor`: 31 pass, 29 suggestions, 0 failures. Suggestions include retained template-root asset drift and the machine-local `core.hooksPath` still pointing at `.husky/_`.
- `pnpm audit --json`: 3 advisories remain as described above.

The full `pnpm run release:check` passed, including migration guards, type checks, builds, lint, unit and type tests, serial browser E2E, D1 E2E, packed artifact checks, and mock package contract checks. The isolated runtime consumer passed on Node.js 24.22.1 with 115 exports checked. The Vite compatibility matrix passed for 5.0.0, 5.4.21, 6.0.0, 6.4.1, 7.0.0, 7.3.6, 8.0.0, 8.3.2, and 8.3.5. A final pack check passed for all 10 published packages. After `pnpm version -r`, the stable release plan is empty with no blockers; the package versions, changelogs, and release ledger are committed locally as `chore(release): version packages`. No packages were published and nothing was pushed.
