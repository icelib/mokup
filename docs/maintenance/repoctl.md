# repoctl maintenance

The repository uses repoctl 6.0.1, pnpm 12.11.2 and Node.js 24.22.1. Development engines stay within `>=24.22.1 <25`; published packages retain `>=22.12.0`. `.node-version` and `.nvmrc` pin the development runtime. Dependency-only maintenance does not change package versions or consume pending release intents.

The global `minimumReleaseAge: 1440` policy remains enabled. This migration excludes only eight reviewed exact releases through `minimumReleaseAgeExclude`:

- `repoctl@6.0.1`
- `@icebreakers/monorepo@6.0.1`
- `@icebreakers/monorepo-templates@3.0.1`
- `@icebreakers/commitlint-config@4.1.4`
- `@icebreakers/eslint-config@8.0.11`
- `@icebreakers/stylelint-config@5.1.5`
- `postcss-tailwindcss@3.1.5`
- `stylelint-plugin-tailwindcss@3.1.5`

Other dependencies and future versions still wait 24 hours. Do not replace these exceptions with unversioned package names or disable the global policy during later upgrades.

## Git hooks

Lefthook 2.2.2 reads `lefthook.yml`. Its postinstall is approved through `allowBuilds.lefthook` in `pnpm-workspace.yaml`; a separate `prepare` script is unnecessary. Run `pnpm install`, then `pnpm exec lefthook install` when migrating an existing checkout. If `git config --local --get core.hooksPath` still reports `.husky` or `.husky/_`, remove that local setting with `git config --local --unset core.hooksPath` before installing. Preserve unrelated custom hook paths and global Git configuration.

The native pre-commit pipeline runs sequentially:

1. ESLint fixes staged code and documents, retaining `--no-warn-ignored`.
2. Stylelint fixes staged styles and Vue SFCs.
3. `repo verify staged-typecheck` checks each affected workspace through its existing script.

Both fixers stage their changes. Lefthook hides unstaged hunks of partially staged files and restores them afterward. A failed check blocks the commit but can retain completed fixes; inspect both `git diff` and `git diff --cached` before retrying. A restore conflict also blocks the commit. Commit messages use `repo verify commit-msg`; pre-push runs full lint followed by typecheck and stops at the first failure.

`pnpm run test:hooks` installs the real hooks only in temporary Git repositories and verifies ordering, unusual paths, renames/deletions, partial staging, unstaged-hunk restoration and failure blocking. The tests never modify this checkout's index. CI and isolated consumer fixtures use `LEFTHOOK=0`.

`pnpm lint` first runs `lint:root` over root tooling/configuration, `.github`, `scripts` and current operation documents, then checks workspace packages through Turbo. CI runs the same root check before its parallel workspace lint command. Historical reports are outside this root check. The new release/deployment scripts and hook configuration therefore remain covered by CI, pre-push and `release:check`.

## Stable releases and recovery

Create intents with `pnpm change` and inspect them with `pnpm exec repo release plan`. The Release workflow runs `plan → verify → prepare → upload → confirm → finalize` as separate stages. Verification retains the repository's full `release:check` gate. Finalization creates a durable release record containing source and package identities.

`release:check` composes `release:check:build`, `release:check:quality` and `release:check:runtime` in order. repoctl runs the same three quality scripts separately because nightly limits each subprocess to 10 minutes. The split retains migration guards, line checks, release tooling tests, types, all builds, lint, unit/type tests, browser/D1 tests and packed-consumer checks.

The existing `repoctl-release-state` branch remains the checkpoint store. Version-scoped patches preserve supported `workspace:^`/`workspace:~` peer ranges and early plan validation; independent state-branch initialization is now supplied by upstream. Keep `pnpm run test:release-tools` passing before changing these patches.

Preserve checkpoints and source identity when recovering interrupted npm publication. A manually supplied `source-sha` must match the workflow run commit; do not override `GITHUB_SHA` or move tags to recover a run. `mode=reconcile` repairs GitHub tags and release metadata only: a successful reconciliation does not finalize the publishing checkpoint or produce a release completion record, so it does not trigger the official website. Resume the original source through the publish/finalize lifecycle to produce that record; if the website alone failed after record creation, retry the Docs workflow with the existing record ID. Prerelease version artifacts must still be prepared and committed locally before dispatch; see [Contributing](../../CONTRIBUTING.md#release-workflow).

## Nightly packages

The Release workflow runs nightly at 03:17 Asia/Shanghai (`main` only) and skips a source commit already published for the channel. Manual operation: **Actions → Release → Run workflow**, select `main`, choose `mode=nightly`, and leave the recovery inputs empty. Use `dry-run` to inspect source and channel state without publishing.

Nightly snapshots include every public workspace package. They run the configured quality checks, build from committed source outside the checkout and publish through npm OIDC/provenance. The npm tag is `snapshot-nightly`; versions include their source/build identity. They do not update `latest`, stable versions, changelogs, release intents or Git tags.

The version-scoped repoctl 6.0.1 patch also corrects its isolated consumer checks before and after publication: consumers install the source workspace's exact TypeScript version and the external optional peers declared by their runtime dependency closure. Package development dependencies are not copied into consumers, and declaration checking keeps `skipLibCheck: false`. This avoids using the older compiler bundled privately by Are the Types Wrong for the independent TypeScript check.

`mokup` declares `repoctl.packageCheck.runtimeAssets: ["./mockServiceWorker.js"]` in its published manifest. The browser Service Worker is a copied resource: checks verify its exact export resolution, package boundary, existence and JavaScript syntax instead of executing its browser globals in Node. Other runtime exports must still import successfully. This manifest change has a patch release intent; the tool upgrade itself does not change product versions. `test:release-tools` exercises the original 25 release regressions, optional-peer and asset contracts, and a real isolated snapshot with both valid and invalid declarations.

```sh
pnpm add -D mokup@snapshot-nightly
```

Configure an npm Trusted Publisher for each public package, matching GitHub repository `icelib/mokup` and workflow `release.yml`, without a GitHub Environment. Run the Release workflow's `oidc-audit` mode before first publication. The workflow verifies the actual snapshot package plan again before upload. No long-lived npm token is required.

Release PR automation can use `REPOCTL_APP_CLIENT_ID` plus `REPOCTL_APP_PRIVATE_KEY`; configure both together. Existing `REPOCTL_RELEASE_TOKEN` / `CHANGESETS_RELEASE_TOKEN` fallbacks remain supported. These GitHub credentials are separate from npm OIDC.

## Website channels

The `website` site covers `apps/mokup-docs`, including its built Playground and Service Worker. Other demo apps are not deployed by this automation.

| Channel | Source                                           | Address                             |
| ------- | ------------------------------------------------ | ----------------------------------- |
| Preview | Current `main` commit                            | <https://next.mokup.icebreaker.top> |
| Stable  | Exact source of a complete stable release record | <https://mokup.icebreaker.top>      |

Preview deploys on `main` updates. Stable deploys only after complete stable release metadata; nightly, prerelease, dry-run, failed and partial releases cannot advance it. The existing official site stays online until the first new complete stable record is available. This migration does not deploy separate PR previews.

Use repoctl's plan command for a read-only local review:

```sh
pnpm exec repo docs plan website --channel preview --source-sha <full-main-sha> --json
pnpm exec repo docs plan website --channel stable --release <completion-record-id> --json
```

Deployment uses the managed Docs workflow, not direct `wrangler deploy` or the removed `docs:deploy` command. The adapter scripts validate repoctl's channel/source identity, verify the generated site, and report the active Cloudflare version before repoctl advances its deployment pointer. Retries reuse an already active matching version.

The workflows reuse the existing organization-level `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets through the `docs-website-preview` and `docs-website-stable` GitHub Environments. The account ID may also be a repository variable. Ensure the token can deploy the Workers and manage their configured custom domains. Disable any existing Cloudflare Git integration that directly deploys `main` to the official Worker, so only the release-driven workflow owns production.

The Workers are separate: `mokup-website-next` (Wrangler environment `next`) serves the preview domain and `mokup-website` serves the official domain. Their origins isolate Service Workers and browser storage. Preview builds carry a visible label and `noindex`; stable metadata and sitemap use the official origin. Both exclude drafts. The deployment build runs VitePress directly outside Turbo's cache so channel and source identity cannot reuse another deployment's site output; dependency package builds retain Turbo caching.

The docs build also disables VitePress's manual framework chunk groups. Those groups otherwise pull page-only code into the Service Worker's shared import helper. A build-time dependency graph check rejects VitePress client or Vue DOM modules reachable from the worker.

At the 2026-10-23 migration review, the Cloudflare dashboard showed no Git repository connected to the production `mokup-website` Worker. Existing organization secrets were available to this repository. Merge first, run the OIDC audit, then validate the preview deployment and nightly publication through Actions. The first preview deployment creates the configured Worker/domain binding; its result must be verified with the organization token. Keep the current production site until a genuine complete stable release creates the first managed baseline. Local builds and consumer tests do not establish npm Trusted Publisher authorization or a deployed website baseline.

Run `pnpm run docs:test`, build both channels through the configured tooling and check the generated artifacts before changing deployment adapters. `pnpm run docs:test:browser` serves the current build with local Wrangler and verifies both homepages, deep links, `/__mokup/`, `/mokup-sw.js`, browser-side mock responses and channel metadata in headless Chrome. It closes its browser and server on completion or failure. Existing development/HMR tests remain separate from deployment checks.
