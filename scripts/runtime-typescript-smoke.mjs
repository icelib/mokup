import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

async function smokeEntry(directory, type, loadModule, tsconfigPath) {
  await fs.mkdir(directory)
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ type }))
  const entry = path.join(directory, 'entry.ts')
  const child = path.join(directory, 'child.ts')
  await fs.writeFile(child, 'export const singleton = { value: 1 }')
  await fs.writeFile(path.join(directory, 'lazy.ts'), 'enum Status { ready = 7 }; export const value = Status.ready')
  const source = revision => `
    import { singleton } from './child.ts'
    import { value as alias } from '@mokup-smoke/alias'
    export { singleton }
    export const version: number = ${revision}
    export default { handler: { version, alias }, default: 'data', __esModule: true }
    export async function lazy() { return (await import('./lazy.ts')).value }
  `
  await fs.writeFile(entry, source(1))
  const options = { tsconfigPath }
  const before = process.env.TSX_TSCONFIG_PATH
  const first = await loadModule(entry, options)
  assert.equal(process.env.TSX_TSCONFIG_PATH, before)
  await fs.writeFile(child, 'export const singleton = { value: 2 }')
  await fs.writeFile(entry, source(2))
  const second = await loadModule(entry, options)
  assert.deepEqual([first.version, second.version], [1, 2])
  assert.deepEqual(second.default, { handler: { version: 2, alias: 9 }, default: 'data', __esModule: true })
  assert.equal(first.singleton, second.singleton)
  assert.equal(second.singleton.value, 1)
  assert.notEqual(first.lazy, second.lazy)
  assert.equal(await first.lazy(), 7)
  assert.equal(await second.lazy(), 7)

  await fs.writeFile(entry, 'throw new Error("typescript evaluation failed")')
  await assert.rejects(loadModule(entry, options), /typescript evaluation failed/)
  await fs.writeFile(entry, source(3))
  assert.equal((await loadModule(entry, options)).version, 3)

  if (type === 'module') {
    await fs.writeFile(entry, 'export default await Promise.resolve({ value: 4 })')
    assert.deepEqual((await loadModule(entry, options)).default, { value: 4 })
  }
  else {
    await fs.writeFile(entry, 'const value: number = 4; module.exports = function () { return value }')
    const handler = await loadModule(entry, options)
    assert.equal(typeof handler, 'function')
    assert.equal(handler(), 4)
  }
}

async function smokeConfig(directory, createFetchServer) {
  await fs.mkdir(directory)
  await fs.writeFile(path.join(directory, 'package.json'), '{"type":"commonjs"}')
  await fs.writeFile(path.join(directory, 'index.config.ts'), `
    import { defineConfig, onBeforeAll } from 'mokup'
    export default defineConfig(async ({ app }) => {
      await Promise.resolve()
      onBeforeAll(() => app.use(async (c, next) => {
        c.header('x-typescript-middleware', 'ready')
        await next()
      }))
      return { headers: { 'x-typescript-config': 'ready' } }
    })
  `)
  await fs.writeFile(path.join(directory, 'value.get.ts'), 'export default { handler: { ready: true } }')
  const app = await createFetchServer({ entries: { dir: directory, watch: false, log: false }, playground: false })
  try {
    const response = await app.fetch(new Request('http://localhost/value'))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-typescript-config'), 'ready')
    assert.equal(response.headers.get('x-typescript-middleware'), 'ready')
    assert.deepEqual(await response.json(), { ready: true })
  }
  finally {
    await app.close?.()
  }
}

async function smokeGlobalConfig(directory, loadModule) {
  const config = path.join(directory, 'next-tsconfig.json')
  await fs.writeFile(path.join(directory, 'next-alias.ts'), 'export const value = 10')
  await fs.writeFile(config, JSON.stringify({
    compilerOptions: { baseUrl: directory, paths: { '@mokup-smoke/alias': ['./next-alias.ts'] } },
  }))
  const esmEntry = path.join(directory, 'module/change-config.ts')
  const entry = path.join(directory, 'new-commonjs/entry.ts')
  await fs.mkdir(path.dirname(entry))
  await fs.writeFile(path.join(directory, 'new-commonjs/package.json'), '{}')
  await fs.writeFile(entry, `
    import { value } from '@mokup-smoke/alias'
    export { value }
    export async function lazy() { return (await import('@mokup-smoke/alias')).value }
  `)
  await fs.writeFile(esmEntry, 'import child from "../new-commonjs/entry.ts"; export default child')
  const changed = await loadModule(esmEntry, { tsconfigPath: config })
  assert.equal(changed.default.value, 10)
  assert.equal(await changed.default.lazy(), 10)
  // No option means reuse the process-wide config, for both static and lazy imports.
  const loaded = await loadModule(entry)
  assert.equal(loaded.value, 10)
  assert.equal(await loaded.lazy(), 10)
}

export async function smokeTypeScriptModules(directory) {
  const { loadModule } = await import('@mokup/shared/module-loader')
  const { createFetchServer } = await import('mokup/server/node')
  const fixtures = await fs.mkdtemp(path.join(directory, 'typescript-formats-'))
  const outside = await fs.mkdtemp(path.join(tmpdir(), 'mokup-no-package-'))
  try {
    const alias = path.join(fixtures, 'alias.ts')
    const tsconfigPath = path.join(fixtures, 'tsconfig.json')
    await fs.writeFile(alias, 'export const value: number = 9')
    await fs.writeFile(tsconfigPath, JSON.stringify({
      compilerOptions: { baseUrl: fixtures, paths: { '@mokup-smoke/alias': ['./alias.ts'] } },
    }))
    for (const type of [undefined, 'commonjs', 'module']) {
      await smokeEntry(path.join(fixtures, type ?? 'default'), type, loadModule, tsconfigPath)
    }
    await smokeGlobalConfig(fixtures, loadModule)
    // This fixture must not inherit the installed consumer's type:module scope.
    const entry = path.join(outside, 'entry.ts')
    for (const value of [1, 2]) {
      await fs.writeFile(entry, `export default { value: ${value} }`)
      assert.deepEqual((await loadModule(entry)).default, { value })
    }
    await smokeConfig(path.join(fixtures, 'mock'), createFetchServer)
  }
  finally {
    await fs.rm(fixtures, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
}

export async function smokeTypeScriptSymlinks(directory) {
  const { loadModule } = await import('@mokup/shared/module-loader')
  const fixtures = await fs.mkdtemp(path.join(directory, 'typescript-symlinks-'))
  try {
    for (const realType of ['module', 'commonjs']) {
      const aliasType = realType === 'module' ? 'commonjs' : 'module'
      const real = path.join(fixtures, realType, 'real')
      const alias = path.join(fixtures, realType, 'alias')
      await fs.mkdir(path.join(real, 'child'), { recursive: true })
      await fs.mkdir(alias)
      await fs.writeFile(path.join(real, 'package.json'), JSON.stringify({ type: realType }))
      await fs.writeFile(path.join(alias, 'package.json'), JSON.stringify({ type: aliasType }))
      await fs.symlink(path.join(real, 'child'), path.join(alias, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
      const entry = path.join(alias, 'link/entry.ts')
      for (const version of [1, 2]) {
        await fs.writeFile(entry, `export const version: number = ${version}; export const kind = typeof module === 'object' ? 'commonjs' : 'module'`)
        const loaded = await loadModule(entry)
        assert.equal(loaded.version, version)
        assert.equal(loaded.kind, process.execArgv.includes('--preserve-symlinks') ? aliasType : realType)
      }
    }
  }
  finally {
    await fs.rm(fixtures, { recursive: true, force: true })
  }
}
