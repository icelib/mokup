import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const { values } = parseArgs({
  options: {
    'pack-only': { type: 'boolean' },
    'runtime-only': { type: 'boolean' },
    'dir': { type: 'string', default: join(tmpdir(), 'mokup-runtime-smoke') },
  },
})
const packDir = resolve(values.dir)
const abortController = new AbortController()

assert(!(values['pack-only'] && values['runtime-only']), 'Choose one smoke phase')

function cleanEnv() {
  const env = { ...process.env }
  delete env.NODE_PATH
  delete env.NODE_OPTIONS
  return env
}

async function run(command, args, cwd, printOutput = true) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    env: cleanEnv(),
    signal: abortController.signal,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 180_000,
  })
  if (printOutput) {
    process.stdout.write(stdout)
    process.stderr.write(stderr)
  }
  return stdout
}

async function packPackages() {
  const packages = []
  const entries = await readdir(join(repoRoot, 'packages'), { withFileTypes: true })
  await mkdir(packDir, { recursive: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const packageDir = join(repoRoot, 'packages', entry.name)
    const pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
    if (pkg.private) {
      continue
    }
    const stdout = await run('pnpm', [
      '--filter',
      pkg.name,
      'pack',
      '--json',
      '--pack-destination',
      packDir,
    ], repoRoot, false)
    const output = JSON.parse(stdout.trim())
    const packed = Array.isArray(output) ? output[0] : output
    assert(packed?.filename, `Missing tarball for ${pkg.name}`)
    packages.push({
      name: pkg.name,
      version: pkg.version,
      filename: relative(packDir, resolve(packDir, packed.filename)),
    })
    process.stdout.write(`runtime smoke packed ${pkg.name}@${pkg.version}\n`)
  }

  assert.equal(packages.length, 9, 'Pack every publishable workspace')
  await copyFile(join(scriptDir, 'runtime-smoke-consumer.mjs'), join(packDir, 'consumer.mjs'))
  const runtimeScripts = [
    'check-runtime-compat.mjs',
    ...(await readdir(scriptDir)).filter(filename => /^runtime-.+-smoke\.mjs$/.test(filename)),
  ]
  for (const filename of runtimeScripts) {
    await copyFile(join(scriptDir, filename), join(packDir, filename))
  }
  await writeFile(join(packDir, 'manifest.json'), JSON.stringify({ packages, runtimeScripts }, null, 2))
  process.stdout.write(`runtime smoke packed ${packages.length} packages into ${packDir}\n`)
}

async function verifyInstalledPackages(consumerDir, packages) {
  for (const pkg of packages) {
    const packageDir = join(consumerDir, 'node_modules', ...pkg.name.split('/'))
    const installedDir = await realpath(packageDir)
    assert(!relative(consumerDir, installedDir).startsWith('..'), `${pkg.name} escaped the consumer`)
    const installed = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
    assert.equal(installed.version, pkg.version, `${pkg.name} must use its packed version`)
    for (const specifier of Object.values(installed.dependencies ?? {})) {
      assert(!specifier.startsWith('workspace:'), `${pkg.name} contains an unresolved workspace dependency`)
    }
  }
}

async function runRuntime() {
  const { packages, runtimeScripts } = JSON.parse(await readFile(join(packDir, 'manifest.json'), 'utf8'))
  assert.equal(packages.length, 9, 'Expected all nine packed workspaces')
  assert(Array.isArray(runtimeScripts), 'Pack the current runtime compatibility fixtures first')
  process.stdout.write(`runtime smoke installing ${packages.length} packed packages on ${process.version}\n`)
  const consumerDir = await realpath(await mkdtemp(join(tmpdir(), 'mokup-consumer-')))
  try {
    const dependencies = Object.fromEntries(packages.map(pkg => [
      pkg.name,
      pathToFileURL(resolve(packDir, pkg.filename)).href,
    ]))
    await writeFile(join(consumerDir, 'package.json'), JSON.stringify({
      name: 'mokup-runtime-smoke-consumer',
      private: true,
      type: 'module',
      dependencies,
    }, null, 2))
    await writeFile(join(consumerDir, '.npmrc'), 'engine-strict=true\npackage-lock=false\naudit=false\nfund=false\n')
    await copyFile(join(packDir, 'consumer.mjs'), join(consumerDir, 'smoke.mjs'))
    for (const filename of runtimeScripts) {
      await copyFile(join(packDir, filename), join(consumerDir, filename))
    }
    await writeFile(join(consumerDir, 'runtime-packages.json'), JSON.stringify(packages))
    const npmCli = process.platform === 'win32'
      ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
      : resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')
    await run(process.execPath, [npmCli, 'install', '--omit=dev', '--engine-strict'], consumerDir)
    await verifyInstalledPackages(consumerDir, packages)
    await run(process.execPath, ['smoke.mjs'], consumerDir)
    await run(process.execPath, ['check-runtime-compat.mjs', '--consumer'], consumerDir)
  }
  finally {
    await rm(consumerDir, { recursive: true, force: true, maxRetries: 3 })
  }
}

async function main() {
  const onSignal = () => abortController.abort()
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    if (!values['runtime-only']) {
      await packPackages()
    }
    if (!values['pack-only']) {
      await runRuntime()
    }
  }
  finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

main().catch((error) => {
  process.stderr.write(`runtime smoke failed: ${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
