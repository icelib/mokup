# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the `mokup` pnpm + Turbo monorepo. **Deployable apps and demos** live under `apps/`, while **publishable packages** live under `packages/`.

### Architecture

- **`apps/`** - Documentation and integration demos:
  - `mokup-docs/` - VitePress documentation site
  - `mokup-vite-*`, `mokup-webpack-demo/`, `mokup-node-demo/` - runnable integration examples
  - `mokup-web-demo/`, `mokup-d1-demo/`, `mokup-middleware-demo/` - runtime and deployment demos

- **`packages/`** - Publishable Mokup packages:
  - `mokup/` - main public package
  - `cli/`, `server/`, `runtime/`, `client/`, `core/`, `query/`, `shared/` - supporting packages
  - `playground/` - docs playground assets

### Build System

- **Package Manager**: pnpm 12.11.2, pinned in root `package.json`
- **Task Orchestration**: Turbo with caching and parallel execution
- **Library Bundler**: tsdown powered by Rolldown
- **Shared Tooling**: repoctl, configured in `repoctl.config.ts` through `repoctl/tooling` wrappers
- **Development Node Version**: `>=24.22.1 <25`; `.node-version`, `.nvmrc` and CI pin Node.js 24.22.1
- **Published Package Runtime**: `>=22.12.0`

## Development Commands

### Core Commands

| Command          | Description                                       |
| ---------------- | ------------------------------------------------- |
| `pnpm install`   | Install all workspace dependencies                |
| `pnpm dev`       | Run all apps in parallel (Turbo `dev --parallel`) |
| `pnpm build`     | Build all workspaces with Turbo caching           |
| `pnpm test`      | Run Vitest, docs, workflow and Git hook tests     |
| `pnpm test:dev`  | Run Vitest in watch mode                          |
| `pnpm lint`      | Check root tooling, then lint all workspaces      |
| `pnpm typecheck` | Run TypeScript type checking                      |
| `pnpm format`    | Auto-fix code with ESLint                         |
| `pnpm validate`  | Run migration guards, typecheck, lint and tests   |

### Release & Publishing

| Command                                 | Description                                           |
| --------------------------------------- | ----------------------------------------------------- |
| `pnpm change`                           | Create a release intent for affected packages         |
| `pnpm exec repo release plan`           | Preview the pending release                           |
| `pnpm run release:check`                | Run the repository release checks                     |
| `pnpm exec repo release stable publish` | Publish an intentional stable release through repoctl |

### Repository Maintenance

| Command                          | Description                                                |
| -------------------------------- | ---------------------------------------------------------- |
| `pnpm exec repo init`            | Initialize repoctl workspace settings                      |
| `pnpm exec repo doctor`          | Inspect workspace health and configuration                 |
| `pnpm exec repo check --dry-run` | Preview workspace checks                                   |
| `pnpm exec repo clean`           | Delete selected workspace package directories after review |

Use `repo clean` only when intentionally removing workspace packages.

### Git & Committing

| Command                                           | Description                                   |
| ------------------------------------------------- | --------------------------------------------- |
| `pnpm exec lefthook install`                      | Install native Git hooks for this checkout    |
| `pnpm exec repo verify staged-typecheck`          | Typecheck workspaces affected by staged files |
| `pnpm exec repo verify commit-msg <message-file>` | Validate a commit message through repoctl     |

Git hooks are configured in `lefthook.yml`. Use `LEFTHOOK=0` for CI and isolated consumer fixtures; do not disable hooks globally. See [repoctl maintenance](docs/maintenance/repoctl.md) when migrating an existing checkout.

## Code Organization

### Test Location

Tests are colocated with their targets in `test/*.test.ts` directories within each workspace. This mirrors the monorepo convention that keeps unit tests adjacent to the code they test.

### Public Assets

Each app manages its own public assets (e.g., `public/`, `worker/`) to keep deployments self-contained.

### Workspace Dependencies

Workspaces use `workspace:*` protocol for internal dependencies; internal peer dependencies also allow `workspace:^` and `workspace:~` to preserve their published compatibility ranges. Root `package.json` contains shared devDependencies. Shared external versions use `catalog:` references to `pnpm-workspace.yaml`, which also owns overrides and installation settings. `.npmrc` is reserved for registry and authentication settings.

## Coding Conventions

- **File Naming**: kebab-case for files (e.g., `user-table.vue`, `api-client.ts`)
- **Export Naming**: PascalCase for components, camelCase for utilities
- **Indentation**: 2 spaces (enforced by `.editorconfig`)
- **Line Endings**: LF (enforced by `.editorconfig`)
- **Language**: TypeScript (`.ts`/`.tsx`) and Vue SFCs preferred

## Quality & Standards

- **ESLint and Stylelint**: repoctl tooling wrappers, with repository settings in `repoctl.config.ts`
- **Testing**: Vitest with v8 coverage (reports to `coverage/`)
- **Commits**: Conventional Commits required, enforced by Lefthook running `repo verify commit-msg`
- **Pre-commit Hooks**: Lefthook runs ESLint fixes, Stylelint fixes and `repo verify staged-typecheck` sequentially; fixes are staged and unstaged hunks are restored afterward
- **Pre-push Hooks**: Lefthook runs full lint, then typecheck, stopping at the first failure

## Publishing Workflow

This monorepo uses pnpm 12 native versioning and repoctl for releases:

1. Make changes to packages
2. Run `pnpm change` to record release intents (patch/minor/major) under `.changeset/`
3. Preview the release with `pnpm exec repo release plan` and run `pnpm run release:check`
4. Let the release workflow prepare and publish the release, or explicitly run `pnpm exec repo release stable publish` for a manual stable release

When modifying publishable packages, always create a release intent so releases stay traceable. Repository changelogs are managed by pnpm native versioning. Dependency maintenance must leave versions unchanged and must not publish packages.

Prerelease commands are `pnpm exec repo release pre enter <tag>`, `pnpm exec repo release pre publish`, and `pnpm exec repo release pre exit`.

## Current Upgrade Notes

- Published packages are ESM-only.
- Internal package builds have been migrated from `unbuild` / `tsup` to `tsdown`.
- Shared build helpers live under `@mokup/shared/rolldown`.
