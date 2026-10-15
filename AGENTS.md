# Repository Guidelines

## Project Structure & Module Organization

This pnpm + Turbo monorepo keeps runnable demos and docs under `apps/` (for example `mokup-web-demo`, `mokup-vite-server-demo`, `mokup-docs`) and publishable libraries under `packages/` (for example `mokup`, `@mokup/server`, `@mokup/runtime`). Shared TypeScript and build settings live in root configs such as `turbo.json`, `tsconfig.json`, and `eslint.config.js`. Unit tests are colocated in workspace `test/*.test.ts`, root integration/e2e tests are in `tests/e2e`, and app-level e2e tests live in `apps/*/test/e2e`.

## Build, Test, and Development Commands

- `pnpm install` — set up workspaces; use Node 24.11+ as defined in `package.json`.
- `pnpm dev` — run `turbo run dev --parallel` for all apps that expose a `dev` script.
- `pnpm build` — execute `turbo run build` to build every workspace with caching.
- `pnpm test` / `pnpm test:dev` — run Vitest suites once or in watch mode across packages.
- `pnpm lint` — invoke `turbo run lint` to apply ESLint/Stylelint policies repo-wide.
- `pnpm script:sync` & `pnpm script:clean` — use the monorepo helper to align dependency versions or clear generated artifacts.

## Coding Style & Naming Conventions

Follow the root `.editorconfig`: two-space indentation, LF line endings, UTF-8. Prefer TypeScript (`.ts`/`.tsx`) and Vue SFCs; name files with kebab-case (`user-table.vue`) and exported symbols with PascalCase for components or camelCase for utilities. ESLint (`@icebreakers/eslint-config`) and Stylelint enforce formatting; run `pnpm lint` before committing, and rely on Husky + lint-staged to auto-fix staged files via `eslint --fix`.
AI-generated code must comply with this project's ESLint and Stylelint rules, and any generated TypeScript must be free of type errors.

## Testing Guidelines

Vitest powers unit tests located in workspace `test/*.test.ts` (for example `packages/server/test/*.test.ts`). Mirror existing naming by matching the unit under test. Aim for meaningful assertions rather than snapshot defaults. `pnpm test` already runs with coverage enabled (reports in `coverage/`). For behavior that crosses packages or runtime/dev-server boundaries, add Playwright coverage under `tests/e2e` or the affected `apps/*/test/e2e`.

## Commit & Pull Request Guidelines

Commits must conform to Conventional Commit syntax; recent history uses prefixes like `feat`, `fix`, and `chore`. Example: `feat(server): add auth router`. Use `pnpm commit` (commitlint prompt) or ensure your manual message passes `pnpm commitlint --edit`. Before opening a PR, make sure `pnpm lint` and `pnpm test` succeed, link related issues, and provide screenshots or logs for user-facing changes. Touching publishable packages requires a changeset (`pnpm changeset`) so releases stay traceable.
