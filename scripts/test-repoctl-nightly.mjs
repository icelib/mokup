/* eslint test/no-import-node-test: off -- Exercise the installed nightly API with isolated Git and registry fixtures. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { createNightlyPlan, releaseNightly } from 'repoctl'

const rootManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const repoRequire = createRequire(import.meta.resolve('repoctl/package.json'))
const engineRequire = createRequire(repoRequire.resolve('@icebreakers/monorepo/package.json'))
const crossSpawn = engineRequire('cross-spawn')
const schedule = '17 19 * * *'
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

async function fixture(t, eventName = 'workflow_dispatch') {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'mokup-nightly-api-')))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const cwd = path.join(temporary, 'source')
  const event = { repository: { full_name: 'fixture/mokup', default_branch: 'main' }, inputs: { mode: 'nightly' }, schedule }
  const env = { ...process.env, LEFTHOOK: '0', CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'fixture/mokup', GITHUB_EVENT_NAME: eventName, GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_PATH: path.join(temporary, 'event.json'), GITHUB_STEP_SUMMARY: path.join(temporary, 'summary.md'), REPOCTL_SNAPSHOT_PUBLISH: '0' }
  const run = (command, args) => {
    const result = crossSpawn.sync(command, args, { cwd, env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return result.stdout.trim()
  }
  async function put(file, value) {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true })
    await writeFile(path.join(cwd, file), value)
  }
  await put('package.json', JSON.stringify({ name: 'fixture', private: true, packageManager: rootManifest.packageManager, scripts: { build: 'node -e "throw new Error(\'Unexpected build during planning\')"' } }))
  await put('pnpm-workspace.yaml', 'packages:\n  - packages/*\nversioning:\n  changelog:\n    storage: repository\n')
  for (const name of ['a', 'b']) {
    await put(`packages/${name}/package.json`, JSON.stringify({ name: `nightly-${name}`, version: '1.0.0', type: 'module', exports: './index.mjs', ...(name === 'b' ? { dependencies: { 'nightly-a': 'workspace:*' } } : {}) }))
    await put(`packages/${name}/index.mjs`, 'export const value = 42;\n')
  }
  await put('.changeset/fixture.md', '---\nnightly-a: patch\n---\nExercise a preserved release intent.\n')
  await put('.gitignore', 'node_modules/\n')
  run('pnpm', ['install', '--lockfile-only', '--ignore-scripts'])
  run('git', ['init', '-q', '-b', 'main'])
  run('git', ['add', '.'])
  run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${temporary}/no-hooks`, 'commit', '-qm', 'nightly fixture'])
  env.GITHUB_SHA = run('git', ['rev-parse', 'HEAD'])
  await writeFile(env.GITHUB_EVENT_PATH, JSON.stringify(event))
  const options = { cwd, env, registryFetch: async () => json({}, 404), outputDirectory: path.join(temporary, 'reports'), config: { nightly: { provider: 'npm', schedule }, qualityScripts: ['build'] } }
  const fingerprint = () => `${run('git', ['status', '--porcelain'])}\n${run('git', ['rev-parse', 'HEAD'])}\n${run('git', ['ls-files', '-s'])}\n${run('git', ['tag', '--list'])}`
  return { options, env, event, run, fingerprint }
}

function publishedChannel(report) {
  const metadata = new Map(report.snapshot.packages.map(pkg => [pkg.name, { name: pkg.name, version: pkg.version, repoctlSnapshot: { ...report.snapshot.identity, identityKey: report.snapshot.identityKey, tag: report.snapshot.tag }, dist: { integrity: `sha512-${'A'.repeat(86)}==` } }]))
  return async (input, init) => {
    assert.ok(!init?.method || init.method === 'GET', 'Planning must not write to the registry')
    const url = new URL(String(input))
    if (url.pathname.startsWith('/-/package/')) {
      const name = decodeURIComponent(url.pathname.split('/')[3])
      return json({ 'latest': '1.0.0', 'snapshot-nightly': metadata.get(name).version })
    }
    return json(metadata.get(decodeURIComponent(url.pathname.split('/')[1])))
  }
}

test('native nightly skips a complete same-commit scheduled channel and leaves source and latest unchanged', async (t) => {
  const h = await fixture(t, 'schedule')
  const before = h.fingerprint()
  const first = await createNightlyPlan(h.options)
  assert.equal(first.status, 'planned', first.error)
  const report = await releaseNightly({ ...h.options, env: { ...h.env, GITHUB_RUN_ID: '124' }, registryFetch: publishedChannel(first) })
  assert.equal(report.status, 'skipped', report.error)
  assert.match(report.reason, /Every public package already matches/)
  assert.deepEqual(report.commands, [])
  assert.deepEqual(report.latest, { 'nightly-a': '1.0.0', 'nightly-b': '1.0.0' })
  assert.ok(report.snapshot.packages.every(pkg => !pkg.tarball))
  assert.equal(h.fingerprint(), before)
  assert.equal(JSON.parse(await readFile(path.join(report.outputDirectory, 'nightly-report.json'), 'utf8')).status, 'skipped')
})

test('manual nightly dispatch plans a fresh identity without consuming stable release intents or publishing', async (t) => {
  const h = await fixture(t)
  const before = h.fingerprint()
  const first = await createNightlyPlan(h.options)
  const report = await releaseNightly({ ...h.options, publish: true, dryRun: true, env: { ...h.env, GITHUB_RUN_ATTEMPT: '2' }, registryFetch: publishedChannel(first) })
  assert.equal(report.status, 'planned', report.error)
  assert.equal(report.buildId, '123-2')
  assert.notEqual(report.snapshot.identityKey, first.snapshot.identityKey)
  assert.ok(report.packages.every(pkg => pkg.locator === `${pkg.name}@snapshot-nightly`))
  assert.ok(report.snapshot.packages.every(pkg => !pkg.tarball))
  assert.equal(h.fingerprint(), before)
  assert.match(await readFile(h.env.GITHUB_STEP_SUMMARY, 'utf8'), /Status: planned/)
})

test('registry failure persists a failed report and summary before any build or publication', async (t) => {
  const h = await fixture(t)
  const report = await releaseNightly({ ...h.options, registryFetch: async () => json({}, 503) })
  assert.equal(report.status, 'failed')
  assert.match(report.error, /HTTP 503/)
  assert.deepEqual(report.commands, [])
  assert.ok(report.snapshot.packages.every(pkg => !pkg.tarball))
  const persisted = JSON.parse(await readFile(path.join(report.outputDirectory, 'nightly-report.json'), 'utf8'))
  assert.equal(persisted.status, 'failed')
  assert.equal(persisted.error, report.error)
  assert.match(await readFile(h.env.GITHUB_STEP_SUMMARY, 'utf8'), /Status: failed/)
})
