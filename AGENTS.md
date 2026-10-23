# Repository Guidelines

## Project Structure & Module Organization

This pnpm + Turbo monorepo keeps runnable demos and docs under `apps/` (for example `mokup-web-demo`, `mokup-vite-server-demo`, `mokup-docs`) and publishable libraries under `packages/` (for example `mokup`, `@mokup/server`, `@mokup/runtime`). Shared TypeScript and build settings live in root configs such as `turbo.json`, `tsconfig.json`, and `eslint.config.js`. Unit tests are colocated in workspace `test/*.test.ts`, root integration/e2e tests are in `tests/e2e`, and app-level e2e tests live in `apps/*/test/e2e`.

## Build, Test, and Development Commands

- `pnpm install` — set up workspaces with the pnpm version pinned in `package.json` and Node.js `>=24.22.1 <25`; CI uses Node.js 24.22.1.
- `pnpm dev` — run `turbo run dev --parallel` for all apps that expose a `dev` script.
- `pnpm build` — execute `turbo run build` to build every workspace with caching.
- `pnpm test` / `pnpm test:dev` — run Vitest suites once or in watch mode across packages.
- `pnpm run test:e2e:d1` — verify authentication and existing accounts against an isolated local D1 database.
- `pnpm run test:vite-compat` — after `pnpm run build:packages`, check the packed loader against supported Vite 5–8 releases in an isolated consumer.
- `pnpm lint` — invoke `turbo run lint` to apply ESLint/Stylelint policies repo-wide.
- `pnpm exec repo doctor` / `pnpm exec repo check` — inspect workspace health and run the repoctl checks.
- `pnpm exec repo clean` — intentionally delete selected workspace package directories after reviewing the selection.

Development and builds require Node.js `>=24.22.1 <25`; CI uses Node.js 24.22.1. Published packages require Node.js `>=22.12.0`; keep these two requirements separate.

## Coding Style & Naming Conventions

Follow the root `.editorconfig`: two-space indentation, LF line endings, UTF-8. Prefer TypeScript (`.ts`/`.tsx`) and Vue SFCs; name files with kebab-case (`user-table.vue`) and exported symbols with PascalCase for components or camelCase for utilities. Shared ESLint, Stylelint and commitlint configuration comes from `repoctl/tooling`; native Git hooks live in `lefthook.yml`. Pre-commit runs ESLint, Stylelint and staged workspace typechecks sequentially; pre-push runs full lint and typecheck. Run `pnpm lint` before committing.
AI-generated code must comply with this project's ESLint and Stylelint rules, and any generated TypeScript must be free of type errors.

## Testing Guidelines

Vitest powers unit tests located in workspace `test/*.test.ts` (for example `packages/server/test/*.test.ts`). Mirror existing naming by matching the unit under test. Aim for meaningful assertions rather than snapshot defaults. `pnpm test` already runs with coverage enabled (reports in `coverage/`). For behavior that crosses packages or runtime/dev-server boundaries, add Playwright coverage under `tests/e2e` or the affected `apps/*/test/e2e`.

## Commit & Pull Request Guidelines

Commits must conform to Conventional Commit syntax; recent history uses prefixes like `feat`, `fix`, and `chore`. Example: `feat(server): add auth router`. Validate the message with `pnpm commitlint --edit`. Before opening a PR, make sure `pnpm lint` and `pnpm test` succeed, link related issues, and provide screenshots or logs for user-facing changes. Touching publishable packages requires a release intent created with `pnpm change` under `.changeset/`. Preview the release with `pnpm exec repo release plan`; versioning uses pnpm 12, and publishing uses `pnpm exec repo release stable publish` after the release checks pass. Dependency upgrades alone must not change package versions or publish packages.

Nightly snapshots use npm's `snapshot-nightly` tag and leave stable versions and release intents unchanged. The website preview follows `main` at `next.mokup.icebreaker.top`; the official website uses the source commit from a complete stable release record. Read `docs/maintenance/repoctl.md` before changing hooks or release/deployment automation. Use `LEFTHOOK=0` for isolated consumer fixtures and CI; do not disable hooks globally.
