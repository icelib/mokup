import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import vm from 'node:vm'

// Read the installed engine so removing or regressing the compatibility patch fails CI.
const repoRequire = createRequire(import.meta.resolve('repoctl/package.json'))
const engineRequire = createRequire(repoRequire.resolve('@icebreakers/monorepo/package.json'))
const dist = path.join(path.dirname(repoRequire.resolve('@icebreakers/monorepo/package.json')), 'dist')
const bundle = (await readdir(dist)).find(name => /^commands-.*\.mjs$/.test(name))
assert.ok(bundle, 'the installed repoctl engine must contain a commands bundle')
const source = await readFile(path.join(dist, bundle), 'utf8')
const { minVersion, validRange, satisfies } = engineRequire('semver')
const { createPackageFromTarballData } = await import(engineRequire.resolve('@arethetypeswrong/core'))
const helpers = source.split('//#region src/commands/package-check/consumer/contracts.ts\n')[1]?.split('//#endregion')[0]
assert.ok(helpers, 'the installed engine must validate declared optional peers and runtime resources')
const entries = source.split('//#region src/commands/package-check/entries.ts\n')[1].split('//#endregion')[0]
const dependencies = source.split('//#region src/commands/package-check/dependencies.ts\n')[1].split('//#endregion')[0]
const identity = source.split('//#region src/commands/release/snapshot/identity.ts\n')[1].split('//#endregion')[0]
const context = vm.createContext({ minVersion, validRange, path, path$1: path, readFile, createHash, createPackageFromTarballData })
vm.runInContext(`${dependencies}\n${helpers}\n${entries}\n${identity}`, context)
const { consumerOptionalPeers, consumerEntries, consumerAssetSource, nightlyConsumerManifests, snapshotMetadata } = context
const plain = value => JSON.parse(JSON.stringify(value))

test('optional peers follow the tested runtime closure and ignore dev dependencies and unrelated packages', () => {
  const root = { name: 'subject', dependencies: { core: '1.0.0' }, devDependencies: { unrelated: '1.0.0' } }
  const core = { name: 'core', dependencies: { subject: '1.0.0' }, peerDependencies: { vite: '^7 || ^8', required: '^1', playground: '1.0.0' }, peerDependenciesMeta: { vite: { optional: true }, playground: { optional: true } } }
  const playground = { name: 'playground' }
  const unrelated = { name: 'unrelated', peerDependencies: { rogue: '*' }, peerDependenciesMeta: { rogue: { optional: true } } }
  const result = plain(consumerOptionalPeers([root], [root, core, playground, unrelated]))
  assert.deepEqual(Object.keys(result), ['vite'])
  assert.equal(satisfies('8.3.5', result.vite), true)
})

test('optional peer range intersections preserve all consumers instead of silently overwriting ranges', () => {
  const first = { name: 'first', peerDependencies: { vite: '^6 || ^8' }, peerDependenciesMeta: { vite: { optional: true } } }
  const second = { name: 'second', peerDependencies: { vite: '>=8.2 <9' }, peerDependenciesMeta: { vite: { optional: true } } }
  const result = plain(consumerOptionalPeers([first, second], [first, second]))
  assert.equal(satisfies('8.3.5', result.vite), true)
  assert.equal(satisfies('8.1.0', result.vite), false)
  assert.equal(satisfies('6.1.0', result.vite), false)
  second.peerDependencies.vite = '^5'
  assert.throws(() => consumerOptionalPeers([first, second], [first, second]), /incompatible declared ranges/)
})

test('optional peer npm aliases retain registry identity', () => {
  const manifest = { name: 'subject', peerDependencies: { framework: 'npm:vite@^8' }, peerDependenciesMeta: { framework: { optional: true } } }
  assert.match(consumerOptionalPeers([manifest], [manifest]).framework, /^npm:vite@/)
})

test('required peers constrain the optional integration provider in the same runtime closure', () => {
  const first = { name: 'first', dependencies: { second: '1.0.0' }, peerDependencies: { vite: '^6 || ^8' }, peerDependenciesMeta: { vite: { optional: true } } }
  const second = { name: 'second', peerDependencies: { vite: '^6' } }
  assert.equal(satisfies('8.3.5', consumerOptionalPeers([first], [first, second]).vite), false)
  assert.equal(satisfies('6.1.0', consumerOptionalPeers([first], [first, second]).vite), true)
})

const workerManifest = {
  name: 'worker-subject',
  type: 'module',
  exports: { '.': './index.mjs', './worker.js': './worker.mjs' },
  repoctl: { packageCheck: { runtimeAssets: ['./worker.js'] } },
}
test('only the explicitly declared worker export is a resource and type checking remains enabled', () => {
  const result = plain(consumerEntries(workerManifest, ['index.mjs', 'worker.mjs']))
  assert.equal(result.find(entry => entry.subpath === '.').asset, false)
  assert.deepEqual(result.find(entry => entry.subpath === './worker.js'), { subpath: './worker.js', target: './worker.mjs', format: 'esm', runtime: true, asset: true })
})

test('unknown, missing, wildcard and non-JavaScript resource declarations fail validation', () => {
  for (const runtimeAssets of [['./typo.js'], ['./worker*'], ['../worker.js'], 'worker.js']) {
    assert.throws(() => consumerEntries({ ...workerManifest, repoctl: { packageCheck: { runtimeAssets } } }, ['index.mjs', 'worker.mjs']), /runtimeAssets|Runtime asset/)
  }
  assert.throws(() => consumerEntries(workerManifest, ['index.mjs']), /must name a packed JavaScript export/)
  assert.throws(() => consumerEntries({ ...workerManifest, exports: { './worker.js': './worker.txt' } }, ['worker.txt']), /must name a packed JavaScript export/)
})

test('worker resources are resolved and syntax checked without executing browser globals', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'repoctl-consumer-contract-'))
  const installed = path.join(directory, 'node_modules', 'worker-subject')
  try {
    await mkdir(installed, { recursive: true })
    await writeFile(path.join(installed, 'package.json'), JSON.stringify(workerManifest))
    await writeFile(path.join(installed, 'index.mjs'), 'export const ok = true;\n')
    await writeFile(path.join(installed, 'worker.mjs'), 'self.addEventListener("fetch", () => {});\n')
    const entry = consumerEntries(workerManifest, ['index.mjs', 'worker.mjs']).find(entry => entry.asset)
    const run = code => spawnSync(process.execPath, ['--input-type', 'module', '--eval', code], { cwd: directory, encoding: 'utf8' })
    assert.notEqual(run('await import("worker-subject/worker.js")').status, 0)
    assert.equal(run(consumerAssetSource(entry, 'worker-subject/worker.js', installed)).status, 0)
    assert.equal(spawnSync(process.execPath, ['--check', path.join(installed, 'worker.mjs')]).status, 0)
    assert.equal(run(consumerAssetSource({ ...entry, target: './index.mjs' }, 'worker-subject/worker.js', installed)).status, 1)
    await writeFile(path.join(installed, 'worker.mjs'), 'function {\n')
    assert.notEqual(spawnSync(process.execPath, ['--check', path.join(installed, 'worker.mjs')]).status, 0)
    await rm(path.join(installed, 'worker.mjs'))
    assert.notEqual(run(consumerAssetSource(entry, 'worker-subject/worker.js', installed)).status, 0)
    const outside = path.join(directory, 'outside.mjs')
    await writeFile(outside, 'export const outside = true;\n')
    await symlink(outside, path.join(installed, 'worker.mjs'))
    assert.notEqual(run(consumerAssetSource(entry, 'worker-subject/worker.js', installed)).status, 0)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('both consumer stages keep resource parsing and strict declaration validation', () => {
  for (const region of ['src/commands/package-check/consumer.ts', 'src/commands/release/nightly/consumer/entries.ts']) {
    const code = source.split(`//#region ${region}\n`)[1].split('//#endregion')[0]
    assert.match(code, /consumerAssetSource\(entry, specifier, installed\)/)
    assert.match(code, /\["--check", path\$1\.resolve\(installed, entry\.target\)\]/)
    assert.match(code, /"--skipLibCheck",\s*"false"/)
    assert.match(code, /if \(checkTypes\)/)
  }
})

test('the published consumer derives peers only from intact tarballs with the confirmed snapshot identity', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'repoctl-consumer-identity-'))
  try {
    const tarball = path.join(directory, 'package.tgz')
    const snapshot = { identity: { kind: 'nightly', commit: 'a'.repeat(40), buildId: 'fixture' }, identityKey: 'b'.repeat(64), tag: 'snapshot-nightly', packages: [] }
    const manifest = { name: 'worker-subject', version: '1.0.0-snapshot.fixture', repoctlSnapshot: plain(snapshotMetadata(snapshot)), peerDependencies: { vite: '^8' }, peerDependenciesMeta: { vite: { optional: true } } }
    await mkdir(path.join(directory, 'package'))
    const pack = async () => {
      await writeFile(path.join(directory, 'package', 'package.json'), JSON.stringify(manifest))
      await engineRequire('tar').c({ gzip: true, file: tarball, cwd: directory }, ['package'])
      const integrity = `sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`
      snapshot.packages = [{ name: manifest.name, version: manifest.version, tarball, integrity }]
    }
    await pack()
    const result = plain(await nightlyConsumerManifests({ snapshot }))
    assert.equal(result[0].peerDependencies.vite, '^8')
    await writeFile(tarball, 'tampered bytes')
    await assert.rejects(nightlyConsumerManifests({ snapshot }), /tarball integrity changed/)
    manifest.repoctlSnapshot.commit = 'c'.repeat(40)
    await pack()
    await assert.rejects(nightlyConsumerManifests({ snapshot }), /tarball identity changed/)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})
