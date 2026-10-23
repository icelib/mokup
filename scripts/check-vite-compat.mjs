import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { inspect, promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const versions = ['5.0.0', '5.4.21', '6.0.0', '6.4.1', '7.0.0', '7.3.6', '8.0.0', '8.3.2', '8.3.5']
const packageNames = ['shared', 'runtime', 'core']

async function run(command, args, cwd, timeout) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      env: { ...process.env, LEFTHOOK: '0', npm_config_ignore_scripts: 'true' },
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    })
    process.stdout.write(stdout)
    process.stderr.write(stderr)
  }
  catch (error) {
    process.stdout.write(error.stdout ?? '')
    process.stderr.write(error.stderr ?? '')
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`, { cause: error })
  }
}

async function prepareConsumer(directory) {
  const tarballs = path.join(directory, 'tarballs')
  await fs.mkdir(tarballs)
  const dependencies = {}
  const packages = []
  for (const name of packageNames) {
    const packageDir = path.join(root, 'packages', name)
    const manifest = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'))
    // Build packages before running this check; packing must never rebuild the workspace.
    await fs.access(path.join(packageDir, 'dist', name === 'core' ? 'module-loader.mjs' : 'index.mjs'))
    const before = new Set(await fs.readdir(tarballs))
    await run('pnpm', ['--filter', manifest.name, 'pack', '--pack-destination', tarballs], root, 180_000)
    const added = (await fs.readdir(tarballs)).filter(filename => !before.has(filename))
    assert.equal(added.length, 1, `Expected one tarball for ${manifest.name}`)
    dependencies[manifest.name] = `file:${path.join(tarballs, added[0])}`
    packages.push({ name: manifest.name, version: manifest.version })
  }
  for (const version of versions) {
    dependencies[`vite${version.replaceAll('.', '_')}`] = `npm:vite@${version}`
  }
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({
    name: 'mokup-vite-compat-consumer',
    private: true,
    type: 'module',
    dependencies,
  }, null, 2))
  for (const filename of ['vite-compat-smoke.mjs', 'vite-compat-fixture.mjs', 'vite-compat-optimizer.mjs']) {
    await fs.copyFile(new URL(`./${filename}`, import.meta.url), path.join(directory, filename))
  }
  await run('npm', ['install', '--omit=dev', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'], directory, 300_000)
  for (const pkg of packages) {
    const installed = JSON.parse(await fs.readFile(path.join(directory, 'node_modules', pkg.name, 'package.json'), 'utf8'))
    assert.equal(installed.version, pkg.version, `Expected locally packed ${pkg.name}`)
  }
}

async function main() {
  assert.equal(process.argv.length, 2, 'Usage: node scripts/check-vite-compat.mjs')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mokup-vite-compat-'))
  const errors = []
  try {
    await prepareConsumer(directory)
    for (const version of versions) {
      // Each version gets a fresh process and imports the installed tarball entry.
      await run(process.execPath, [path.join(directory, 'vite-compat-smoke.mjs'), version], directory, 180_000)
    }
  }
  catch (error) {
    errors.push(error)
  }
  finally {
    try {
      await fs.rm(directory, { recursive: true, force: true })
    }
    catch (error) {
      errors.push(new Error(`Failed to remove consumer ${directory}`, { cause: error }))
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Vite artifact compatibility failed')
  }
  process.stdout.write(`Vite artifact compatibility ok (${versions.join(', ')})\n`)
}

main().catch((error) => {
  process.stderr.write(`${inspect(error, { depth: 8 })}\n`)
  process.exitCode = 1
})
