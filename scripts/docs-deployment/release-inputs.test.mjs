/* eslint test/no-import-node-test: off -- Exercise the public repoctl planning API without publishing or writing remote state. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadMonorepoConfig, planDocsDeployment } from 'repoctl'

const root = fileURLToPath(new URL('../../', import.meta.url))

it('the website covers every public package and rejects unpublished product inputs', async () => {
  const { commands: { docs } } = await loadMonorepoConfig(root)
  const site = docs.sites.website
  const directories = await readdir(path.join(root, 'packages'), { withFileTypes: true })
  const manifests = await Promise.all(directories.filter(entry => entry.isDirectory()).map(async (entry) => {
    return JSON.parse(await readFile(path.join(root, 'packages', entry.name, 'package.json'), 'utf8'))
  }))
  assert.deepEqual(manifests.filter(manifest => !manifest.private).map(manifest => manifest.name).sort(), [...site.packages].sort())
  const cwd = await mkdtemp(path.join(tmpdir(), 'mokup-site-inputs-'))
  const records = new Map()
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  const workspace = 'packages:\n  - packages/*\ncatalog:\n  hono: ^4.0.0\n  unused: ^1.0.0\n'
  async function put(filename, value) {
    await mkdir(path.dirname(path.join(cwd, filename)), { recursive: true })
    await writeFile(path.join(cwd, filename), value)
  }
  function commit() {
    git('add', '.')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', `core.hooksPath=${cwd}/no-hooks`, 'commit', '-qm', 'fixture')
    const sha = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/origin/main', sha)
    return sha
  }
  async function plan(sourceSha, baseline, omitted) {
    const value = {
      schemaVersion: 1,
      repository: 'fixture/mokup',
      branch: 'main',
      distTag: 'latest',
      sourceSha,
      packages: site.packages.filter(name => name !== omitted).map(name => ({ name, version: name === 'mokup' ? '1.1.0' : '1.0.0', sourceSha: name === 'mokup' ? sourceSha : baseline })),
      releasedPackages: ['mokup'],
      checkpointKey: 'a'.repeat(64),
    }
    const id = createHash('sha256').update(JSON.stringify(value)).digest('hex')
    records.set(`releases/${id}`, { value: { ...value, id }, revision: id })
    return planDocsDeployment({
      cwd,
      site: 'website',
      channel: 'stable',
      release: id,
      config: docs,
      env: { GITHUB_REPOSITORY: 'fixture/mokup' },
      github: {
        readAutomationState: async key => records.get(key),
        readBranchHead: async () => git('rev-parse', 'refs/remotes/origin/main'),
        writeAutomationState: async () => { throw new Error('Planning must not write remote state') },
      },
    })
  }
  try {
    git('init', '-q', '-b', 'main')
    await put('package.json', JSON.stringify({ name: 'fixture', private: true, packageManager: 'pnpm@12.13.0' }))
    await put('pnpm-workspace.yaml', workspace)
    await put('pnpm-lock.yaml', 'lockfileVersion: 9.0\n')
    await put('tsconfig.json', '{}\n')
    await put('scripts/tsdown-config.ts', 'export const config = {}\n')
    for (const name of site.packages) {
      const directory = site.releaseInputs[name][0].replace(/\/\*\*$/u, '')
      await put(`${directory}/package.json`, JSON.stringify({ name, version: '1.0.0', ...(name === '@mokup/shared' ? { dependencies: { hono: 'catalog:' } } : {}) }))
      await put(`${directory}/src/index.ts`, 'export const released = true\n')
    }
    const baseline = commit()
    await put('packages/mokup/package.json', JSON.stringify({ name: 'mokup', version: '1.1.0' }))
    await put('packages/mokup/src/index.ts', 'export const released = "new stable feature"\n')
    await put('pnpm-lock.yaml', 'lockfileVersion: 9.0\n# updated by the partial release\n')
    const releaseSha = commit()
    const released = await plan(releaseSha, baseline)
    assert.equal(released.eligible, true, released.blockers.join('\n'))
    assert.equal(released.skipped, false)

    const incomplete = await plan(releaseSha, baseline, '@mokup/client')
    assert.equal(incomplete.eligible, false)
    assert.ok(incomplete.blockers.includes('No completed stable publication for @mokup/client@1.0.0'))

    for (const filename of ['.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/repoctl-docs.yml', 'scripts/docs-deployment/deploy.mjs', 'apps/mokup-docs/docs/index.md']) {
      await put(filename, '# source repository automation and documentation only\n')
    }
    await put('pnpm-workspace.yaml', workspace.replace('unused: ^1.0.0', 'unused: ^2.0.0'))
    const automation = await plan(commit(), baseline)
    assert.equal(automation.eligible, true, automation.blockers.join('\n'))

    await put('packages/client/src/index.ts', 'export const unpublished = true\n')
    const unpublished = await plan(commit(), baseline)
    assert.equal(unpublished.eligible, false)
    assert.ok(unpublished.blockers.includes('Unpublished inputs for @mokup/client: packages/client/src/index.ts'))
    await put('packages/client/src/index.ts', 'export const released = true\n')

    await put('.changeset/pending-client.md', '---\n"@mokup/client": patch\n---\nUnreleased client behavior.\n')
    const intent = await plan(commit(), baseline)
    assert.equal(intent.eligible, false)
    assert.ok(intent.blockers.some(blocker => blocker.includes('Unconsumed release intent for @mokup/client')))
    await rm(path.join(cwd, '.changeset/pending-client.md'))

    await put('pnpm-workspace.yaml', workspace.replace('hono: ^4.0.0', 'hono: ^4.1.0'))
    const catalog = await plan(commit(), baseline)
    assert.equal(catalog.eligible, false)
    assert.ok(catalog.blockers.some(blocker => blocker.startsWith('Unpublished catalog dependency for @mokup/shared:') && blocker.includes('hono')), catalog.blockers.join('\n'))
    await put('pnpm-workspace.yaml', workspace)

    for (const filename of ['tsconfig.json', 'scripts/tsdown-config.ts']) {
      await put(filename, '// changed shared build input\n')
      const shared = await plan(commit(), baseline)
      assert.equal(shared.eligible, false)
      assert.ok(shared.blockers.includes(`Unpublished inputs for @mokup/client: ${filename}`))
      await put(filename, filename === 'tsconfig.json' ? '{}\n' : 'export const config = {}\n')
    }
    await put('packages/runtime/src/index.ts', 'export const unpublished = true\n')
    const playground = await plan(commit(), baseline)
    assert.ok(playground.blockers.includes('Unpublished inputs for @mokup/playground: packages/runtime/src/index.ts'))
  }
  finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
