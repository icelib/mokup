/* eslint test/no-import-node-test: off -- Validate the installed release engine with real isolated snapshot consumers. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { it } from 'node:test'
// eslint-disable-next-line e18e/ban-dependencies -- Resolve pnpm.cmd without shell interpolation on Windows.
import { execaSync } from 'execa'
import { releaseSnapshot } from 'repoctl'

const root = new URL('../', import.meta.url)
const rootManifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const typescript = JSON.parse(await readFile(createRequire(import.meta.url).resolve('typescript/package.json'), 'utf8')).version

it('snapshot consumers install the source TypeScript compiler without weakening declaration checks', { timeout: 120_000 }, async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'mokup-snapshot-typescript-')))
  const cwd = path.join(temporary, 'source')
  await mkdir(cwd)
  const env = { ...process.env, LEFTHOOK: '0', CI: 'true', COREPACK_ENABLE_AUTO_PIN: '0', npm_config_registry: 'https://registry.npmjs.org/' }
  const run = (command, args) => execaSync(command, args, { cwd, env, timeout: 60_000 }).stdout.trim()
  async function put(filename, value) {
    await mkdir(path.dirname(path.join(cwd, filename)), { recursive: true })
    await writeFile(path.join(cwd, filename), value)
  }
  function commit() {
    run('git', ['add', '.'])
    run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${temporary}/no-hooks`, 'commit', '-qm', 'snapshot fixture'])
    return run('git', ['rev-parse', 'HEAD'])
  }
  async function snapshot() {
    return releaseSnapshot({
      cwd,
      env,
      identity: { kind: 'nightly', commit: commit(), buildId: 'typescript-regression' },
      outputDirectory: path.join(temporary, 'artifacts'),
    })
  }
  try {
    await put('package.json', JSON.stringify({
      name: 'mokup-snapshot-typescript-fixture',
      private: true,
      packageManager: rootManifest.packageManager,
      devDependencies: { typescript },
      scripts: { build: 'node build.mjs' },
    }))
    await put('pnpm-workspace.yaml', 'packages:\n  - packages/*\nversioning:\n  changelog:\n    storage: repository\n')
    await put('.gitignore', 'node_modules/\npackages/*/dist/\n')
    await put('build.mjs', `import { mkdir, readFile, writeFile } from 'node:fs/promises';
for (const name of ['typed', 'javascript']) {
  const directory = 'packages/' + name;
  await mkdir(directory + '/dist', { recursive: true });
  await writeFile(directory + '/dist/index.mjs', 'export const bytes = new Uint8Array(0)');
  if (name === 'typed') await writeFile(directory + '/dist/index.d.mts', await readFile(directory + '/index.d.mts'));
}`)
    await put('packages/typed/package.json', JSON.stringify({
      name: '@mokup-snapshot-fixture/typed',
      version: '1.0.0',
      type: 'module',
      license: 'MIT',
      files: ['dist'],
      exports: { '.': { types: './dist/index.d.mts', import: './dist/index.mjs' } },
    }))
    await put('packages/typed/index.d.mts', 'export declare const bytes: Uint8Array<ArrayBuffer>;\n')
    await put('packages/javascript/package.json', JSON.stringify({
      name: '@mokup-snapshot-fixture/javascript',
      version: '1.0.0',
      type: 'module',
      license: 'MIT',
      files: ['dist'],
      exports: './dist/index.mjs',
    }))
    run('pnpm', ['install', '--lockfile-only', '--ignore-scripts'])
    run('git', ['init', '-q', '-b', 'main'])
    const valid = await snapshot()
    assert.equal(valid.status, 'prepared', JSON.stringify(valid.checks?.flatMap(check => check.diagnostics.filter(item => item.severity === 'error'))))
    const checked = valid.checks.find(check => check.name === '@mokup-snapshot-fixture/typed')
    const command = checked.commands.find(item => item.args.includes('--noEmit'))
    assert.ok(command, 'Typed snapshots must exercise the installed consumer declarations')
    const compiler = await realpath(command.args[0])
    const relative = path.relative(await realpath(command.cwd), compiler)
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'TypeScript must run inside the isolated consumer')
    const consumerManifest = JSON.parse(await readFile(path.join(command.cwd, 'package.json'), 'utf8'))
    assert.equal(consumerManifest.devDependencies.typescript, typescript)
    assert.equal(JSON.parse(await readFile(path.join(command.cwd, 'node_modules/typescript/package.json'), 'utf8')).version, typescript)
    assert.deepEqual(command.args.slice(command.args.indexOf('--skipLibCheck'), command.args.indexOf('--skipLibCheck') + 2), ['--skipLibCheck', 'false'])
    const packedManifest = JSON.parse(await readFile(path.join(command.cwd, 'node_modules/@mokup-snapshot-fixture/typed/package.json'), 'utf8'))
    assert.equal(packedManifest.devDependencies, undefined, 'Consumer test tooling must not leak into the published package')
    const javascript = valid.checks.find(check => check.name === '@mokup-snapshot-fixture/javascript')
    const jsConsumer = javascript.commands.find(item => item.args.includes('install')).cwd
    assert.equal(JSON.parse(await readFile(path.join(jsConsumer, 'package.json'), 'utf8')).devDependencies, undefined)

    await put('packages/typed/index.d.mts', 'export declare const bytes: Uint8Array<ArrayBuffer>;\nexport interface Invalid { [key: string]: string; enabled: boolean }\n')
    const invalid = await snapshot()
    assert.equal(invalid.status, 'failed')
    assert.ok(invalid.checks.some(check => check.diagnostics.some(item => item.code === 'TYPESCRIPT_CONSUMER' && item.message.includes('TS2411'))), 'Invalid published declarations must still fail the gate')
  }
  finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
