# Contributing

## Baseline

- Use Node.js `>=24.22.1 <25` for development and builds; CI uses Node.js 24.22.1
- Use the pnpm version pinned in the root `package.json`
- Preserve the published packages' runtime requirement: `>=22.12.0`
- Keep published packages ESM-only
- Keep published library packages on `tsdown` + `rolldown`

The development Node.js minimum follows the shared tooling and jsdom requirements. `.node-version` and `.nvmrc` pin Node.js 24.22.1. Shared repository tooling is configured through `repoctl.config.ts` and the `repoctl/tooling` wrappers. Dependency catalogs, overrides, and installation settings live in `pnpm-workspace.yaml`; `.npmrc` contains registry and authentication settings.

## Before Opening A PR

- Run `pnpm run guard:migration`
- Run `pnpm run typecheck:fast` while iterating (optional, faster local feedback)
- Run `pnpm typecheck`
- Run `pnpm lint`
- Run `pnpm run lint:lines` for strict line-budget checks (or `pnpm run lint:lines:guard` for CI-compatible guard mode)
- Run `pnpm test`
- Run `pnpm test:e2e:serial` for changes that may affect demos, dev server flow, HMR, or root Playwright E2E coverage
- Run `pnpm test:e2e:d1` when changing D1, Drizzle, or Better Auth integration
- Add a release intent with `pnpm change` when publishable packages change, and review `pnpm exec repo release plan`

## Repository Maintenance

- `pnpm exec repo doctor` inspects the workspace and its tooling configuration.
- `pnpm exec repo check --dry-run` previews the checks; `pnpm exec repo check` runs them.
- `pnpm run lint:root` checks root configuration, `.github`, `scripts` and current operation documents; `pnpm lint` and CI run it before workspace lint. Historical reports are excluded.
- `pnpm exec repo clean` deletes selected workspace package directories. Use it only when intentionally removing those packages and review the selection before confirming.
- See [Dependency Security Maintenance](docs/maintenance/dependency-security.md) for security overrides, remaining advisories, and recheck commands.
- See [repoctl Maintenance](docs/maintenance/repoctl.md) for native Git hooks, nightly packages, website channels and CI credentials.

## Release Workflow

Release intents remain Markdown files under `.changeset/`, created with `pnpm change`. pnpm 12 handles versioning and stores changelogs in the repository; repoctl manages release preparation and publishing.

1. Describe the affected packages and bump levels with `pnpm change`.
2. Review the pending release with `pnpm exec repo release plan`.
3. Run `pnpm run release:check` before releasing.
4. Let the release workflow prepare and publish the release, or use `pnpm exec repo release stable publish` for an intentional manual stable release.

The repoctl 6 workflow separates planning, preparation, verification, npm publishing and metadata completion. Prereleases still require a prepared version commit before workflow dispatch so npm trusted publishing identifies the artifacts actually built. On the matching `alpha`, `beta`, `rc` or `next` branch, enter its lane with `pnpm exec repo release pre enter alpha` (replace `alpha` as needed), create intents with `pnpm change`, and commit the lane and intent changes. Review `pnpm exec repo release plan`, run `pnpm run release:check`, then run `pnpm version -r` locally. Commit and push the version, changelog and release-ledger changes before dispatching Release with `mode=auto`. Automatic preparation can change the source commit after a workflow starts, which conflicts with its OIDC identity; the workflow rejects pending prerelease intents. Exit the lane with `pnpm exec repo release pre exit` when returning to stable releases.

Nightly snapshots run daily at 03:17 Asia/Shanghai when `main` has changed, with manual dispatch available. They use the `snapshot-nightly` npm tag and do not consume release intents or update stable versions. Website preview and official deployments follow separate source policies described in [repoctl Maintenance](docs/maintenance/repoctl.md).

Dependency maintenance should leave package versions and release intents pending for the release workflow.

### Release checkpoint recovery

The `repoctl-release-state` branch stores durable publishing checkpoints. Its initial commit contains only checkpoint documentation, with no source-tree parent or workflow files. Each checkpoint retains the original package source commit separately. A version commit can predate workflow fixes, so initializing this branch from that commit can require workflow permissions unavailable to `GITHUB_TOKEN`.

repoctl 6.0.1 includes the independent state-branch initialization fix. The current version-scoped pnpm patch preserves the repository's workspace peer-range policy and early release-plan validation; it no longer patches state-branch initialization. `pnpm run test:release-tools` exercises the installed repoctl client with a simulated GitHub API, including concurrent creation and checkpoint conflicts, and tests the workspace dependency contract. Keep these tests when upgrading repoctl.

The release plan carries the prepared source identity between jobs. Verification and npm publishing check out that source; successful metadata completion writes a durable release record. The official website requires a complete stable release record rather than inferring release success from a tag or package version.

After a failed release, inspect the preserved plan/progress artifacts, the state branch, and npm before retrying. Preserve existing versions and intents. If publication already began, preserve its checkpoint and source identity instead of starting a fresh release. Use `repo release plan` for a read-only preview and the workflow's recovery mode for the failed stage.

The OIDC workflow rejects a `source-sha` different from its run commit. Resume npm publication from the original prepared source; use reconciliation when only GitHub metadata is missing after npm publication. Reconciliation alone does not finalize the checkpoint or create a release completion record. Resume publish/finalize on the original source to complete that lifecycle before the official website can advance; retry a website-only failure with its existing completion record ID. Do not override `GITHUB_SHA` or move release tags to repair a failed run.

## Line Budget Guard

`scripts/lint-lines.mjs` checks non-comment source lines in `packages/*/src` and currently uses a `300`-line budget per file.

- `pnpm run lint:lines` runs in fail-fast mode (`--mode=error`)
- `pnpm run lint:lines:warn` reports oversized files without failing
- `pnpm run lint:lines:guard` warns for files above `300` lines and fails for files above `500` lines

CI currently uses guard mode to keep existing hotspots visible while still blocking extreme file growth. For new or heavily touched files, prefer extracting reusable helpers/components to keep files under the budget.

## Migration Guards

The repository enforces the post-migration constraints in `scripts/check-migration-guards.mjs`.

The guard blocks:

- Reintroducing `@mokup/shared/esbuild`
- Direct `esbuild` imports in repository code or config
- Reintroducing `tsup`, `unbuild`, or `build.config.*` in active code/config
- The root workspace or demo apps drifting away from `engines.node: ">=24.22.1 <25"`
- Published library packages drifting away from:
  - `type: "module"`
  - `engines.node: ">=22.12.0"`
  - `build: "tsdown"`
  - `dev: "tsdown --watch"`
  - ESM-only `exports`

If you intentionally change these rules, update the guard script, its tests, and the migration docs in the same PR.
