import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cliBin = path.join(rootDir, 'packages/mokup/dist/cli-bin.mjs')
const serverFetch = path.join(rootDir, 'packages/server/dist/fetch.mjs')

async function run(command, args, cwd, env = {}) {
  return await execa(command, args, {
    cwd,
    env: { ...process.env, ...env, HUSKY: '0' },
    maxBuffer: 8 * 1024 * 1024,
  })
}

async function writeFixture(directory) {
  const mockDir = path.join(directory, 'mock')
  await fs.mkdir(mockDir, { recursive: true })
  await fs.writeFile(
    path.join(mockDir, 'health.get.ts'),
    [
      'export default {',
      '  handler: () => new Response(JSON.stringify({ ok: true }), {',
      '    headers: { "content-type": "application/json" },',
      '  }),',
      '}',
      '',
    ].join('\n'),
  )
  return mockDir
}

async function verifyInstalledPackage(directory) {
  const verifyFile = path.join(directory, 'verify.mjs')
  await fs.writeFile(verifyFile, [
    'import assert from \'node:assert/strict\'',
    'import bundle from \'@mokup/example-mocks\'',
    'import manifest from \'@mokup/example-mocks/manifest\'',
    `import { createFetchHandler } from ${JSON.stringify(pathToFileURL(serverFetch).href)}`,
    '',
    'assert.equal(bundle.manifest.routes.length, 1)',
    'assert.equal(manifest.routes.length, 1)',
    'assert.equal(bundle.manifest.routes[0].url, \'/health\')',
    'const handler = createFetchHandler({ ...bundle, onNotFound: \'response\' })',
    'const response = await handler(new Request(\'http://localhost/health\'))',
    'assert.equal(response.status, 200)',
    'assert.deepEqual(await response.json(), { ok: true })',
    'assert.equal((await handler(new Request(\'http://localhost/missing\'))).status, 404)',
    '',
  ].join('\n'))
  await run(process.execPath, [verifyFile], directory)
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mokup-package-contract-'))
  try {
    const mockDir = await writeFixture(directory)
    const outputDir = path.join(directory, 'package')
    await run(process.execPath, [cliBin, 'build', '--dir', mockDir, '--out', outputDir], rootDir)

    const packageJson = {
      name: '@mokup/example-mocks',
      version: '0.0.0-contract-test',
      private: false,
      type: 'module',
      files: [
        'mokup.bundle.mjs',
        'mokup.bundle.d.ts',
        'mokup.bundle.d.mts',
        'mokup.manifest.mjs',
        'mokup.manifest.d.mts',
        'mokup-handlers',
      ],
      exports: {
        '.': {
          types: './mokup.bundle.d.ts',
          import: './mokup.bundle.mjs',
          default: './mokup.bundle.mjs',
        },
        './manifest': {
          types: './mokup.manifest.d.mts',
          import: './mokup.manifest.mjs',
          default: './mokup.manifest.mjs',
        },
      },
    }
    await fs.writeFile(path.join(outputDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
    const packResult = await run('npm', ['pack', '--json', '--pack-destination', directory], outputDir)
    const packed = JSON.parse(packResult.stdout)[0]
    assert.ok(packed?.filename, 'npm pack must return a tarball')
    const packedFiles = new Set((packed.files ?? []).map(file => file.path))
    for (const required of [
      'package.json',
      'mokup.bundle.mjs',
      'mokup.bundle.d.ts',
      'mokup.manifest.mjs',
      'mokup-handlers/index.mjs',
    ]) {
      assert.ok(packedFiles.has(required), `mock package must contain ${required}`)
    }

    const consumer = path.join(directory, 'consumer')
    await fs.mkdir(consumer)
    await fs.writeFile(path.join(consumer, 'package.json'), JSON.stringify({
      name: 'mokup-package-contract-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@mokup/example-mocks': `file:${path.join(directory, packed.filename)}`,
      },
    }, null, 2))
    await run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], consumer)
    await verifyInstalledPackage(consumer)
    process.stdout.write('mock package contract ok (packed exports, manifest, handlers and runtime execution)\n')
  }
  finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`mock package contract failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
