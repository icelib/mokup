import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const loaderUrl = new URL('../src/module-loader.ts', import.meta.url).href
// Resolve before spawning so --preserve-symlinks also works with pnpm's tsx layout.
const tsxUrl = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href

async function checkInNode(body: string, nodeOptions: string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), 'mokup-module-freshness-'))
  try {
    const source = `
      import assert from 'node:assert/strict'
      import { mkdir, symlink, writeFile } from 'node:fs/promises'
      import { createRequire } from 'node:module'
      import { join } from 'node:path'
      const directory = ${JSON.stringify(directory)}
      const loaderUrl = ${JSON.stringify(loaderUrl)}
      const { loadModule } = await import(loaderUrl)
      const originalNow = Date.now
      try {
        await writeFile(join(directory, 'package.json'), '{"type":"module"}')
        ${body}
      } finally {
        Date.now = originalNow
      }
      process.stdout.write('Module freshness checks passed')
    `
    const result = await execFileAsync(process.execPath, [
      '--unhandled-rejections=strict',
      ...nodeOptions,
      '--import',
      tsxUrl,
      '--input-type=module',
      '-e',
      source,
    ], { timeout: 15000 })

    expect(result.stdout).toBe('Module freshness checks passed')
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('native module entry freshness', () => {
  it.each(['mjs', 'js', 'ts'])('reloads .%s entries with frozen and regressed clocks', async (extension) => {
    await checkInNode(`
      const file = join(directory, 'value.${extension}')
      const values = []
      for (const [index, clock] of [1000, 1000, 1001, 1000].entries()) {
        await writeFile(file, 'export const value${extension === 'ts' ? ': number' : ''} = ' + (index + 1))
        Date.now = () => clock
        values.push((await loadModule(file)).value)
      }
      assert.deepEqual(values, [1, 2, 3, 4])
    `)
  }, 20000)

  it.each(['mjs', 'js', 'ts'])('evaluates unchanged .%s entries on every load', async (extension) => {
    await checkInNode(`
      const file = join(directory, 'evaluation.${extension}')
      globalThis.mokupEvaluationCount = 0
      await writeFile(file, 'export const count = ++globalThis.mokupEvaluationCount')
      Date.now = () => 2000
      const first = await loadModule(file)
      const second = await loadModule(file)
      const third = await loadModule(file)
      assert.deepEqual([first.count, second.count, third.count], [1, 2, 3])
      assert.notEqual(first, second)
      assert.notEqual(second, third)
    `)
  }, 20000)

  it.each(['mjs', 'js', 'ts'])('preserves the shared dependency of a reloaded .%s entry', async (extension) => {
    await checkInNode(`
      const file = join(directory, 'entry.${extension}')
      const child = join(directory, 'child.${extension}')
      const entrySource = version =>
        'export { singleton } from "./child.${extension}"; export const version = ' + version
      await writeFile(child, 'export const singleton = { value: "original child" }')
      await writeFile(file, entrySource(1))
      Date.now = () => 2500
      const first = await loadModule(file)
      await writeFile(child, 'export const singleton = { value: "rewritten child" }')
      await writeFile(file, entrySource(2))
      const second = await loadModule(file)
      assert.deepEqual([first.version, second.version], [1, 2])
      assert.equal(first.singleton, second.singleton)
      assert.deepEqual(second.singleton, { value: 'original child' })
    `)
  }, 20000)

  it('keeps lazy TypeScript imports working for handlers retained across reloads', async () => {
    await checkInNode(`
      const file = join(directory, 'lazy-entry.ts')
      const child = join(directory, 'lazy-child.ts')
      await writeFile(child, 'enum Status { ready = 7 }; export const value = Status.ready')
      await writeFile(file, [
        'export async function handler(): Promise<number> {',
        'const child = await import("./lazy-child.ts");',
        'return child.value;',
        '}',
      ].join(' '))
      Date.now = () => 2700
      const first = await loadModule(file)
      const second = await loadModule(file)
      assert.notEqual(first.handler, second.handler)
      assert.equal(await first.handler(), 7)
      assert.equal(await second.handler(), 7)
    `)
  }, 20000)

  it('keeps independent loader instances from reusing an entry identity', async () => {
    await checkInNode(`
      const firstLoader = await import(loaderUrl + '?loader=first')
      const secondLoader = await import(loaderUrl + '?loader=second')
      assert.notEqual(firstLoader.loadModule, secondLoader.loadModule)
      const file = join(directory, 'instances.mjs')
      Date.now = () => 3000
      const values = []
      for (const [index, loader] of [firstLoader, secondLoader, firstLoader, secondLoader].entries()) {
        await writeFile(file, 'export const value = ' + (index + 1))
        values.push((await loader.loadModule(file)).value)
      }
      assert.deepEqual(values, [1, 2, 3, 4])
    `)
  }, 20000)

  it.each(['mjs', 'js', 'ts'])('retries a failed .%s evaluation after the entry is repaired', async (extension) => {
    await checkInNode(`
      const file = join(directory, 'repair.${extension}')
      Date.now = () => 4000
      await writeFile(file, 'throw new Error("fixture evaluation failed")')
      await assert.rejects(loadModule(file), /fixture evaluation failed/)
      await writeFile(file, 'export const value${extension === 'ts' ? ': number' : ''} = 42')
      assert.equal((await loadModule(file)).value, 42)
    `)
  }, 20000)

  it('returns null for unsupported files without evaluating or reading them', async () => {
    await checkInNode(`
      const file = join(directory, 'unsupported.txt')
      await writeFile(file, 'throw new Error("must not execute")')
      assert.equal(await loadModule(file), null)
      assert.equal(await loadModule(join(directory, 'missing.txt')), null)
    `)
  }, 20000)
})

describe('CommonJS module entry freshness', () => {
  it.each([false, true])('reloads the resolved entry and preserves its child singleton, preserveSymlinks=%s', async (preserveSymlinks) => {
    await checkInNode(`
      const realDirectory = join(directory, 'real')
      const aliasDirectory = join(directory, 'alias')
      await mkdir(realDirectory)
      await symlink(realDirectory, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir')
      const entry = join(aliasDirectory, 'entry.cjs')
      const child = join(realDirectory, 'child.cjs')
      const require = createRequire(import.meta.url)
      await writeFile(child, 'module.exports = { value: "original child" }')
      const entrySource = version => [
        'module.exports = function handler() { return ' + version + ' }',
        'module.exports.version = ' + version,
        'module.exports.child = require("./child.cjs")',
      ].join(';')
      await writeFile(entry, entrySource(1))
      const resolvedEntry = require.resolve(entry)
      const first = await loadModule(entry)
      assert.equal(typeof first, 'function')
      assert.equal(first(), 1)
      assert.equal(first.version, 1)
      assert.deepEqual(Object.keys(first).sort(), ['child', 'version'])
      assert.equal(require.cache[resolvedEntry].exports, first)

      await writeFile(child, 'module.exports = { value: "rewritten child" }')
      await writeFile(entry, entrySource(2))
      const second = await loadModule(entry)
      assert.equal(typeof second, 'function')
      assert.equal(second(), 2)
      assert.equal(second.version, 2)
      assert.deepEqual(Object.keys(second).sort(), ['child', 'version'])
      assert.notEqual(first, second)
      assert.equal(require.cache[resolvedEntry].exports, second)
      assert.equal(second.child, first.child)
      assert.deepEqual(second.child, { value: 'original child' })

      await writeFile(entry, 'throw new Error("CJS fixture failed")')
      await assert.rejects(loadModule(entry), /CJS fixture failed/)
      await writeFile(entry, entrySource(3))
      const repaired = await loadModule(entry)
      assert.equal(repaired(), 3)
      assert.equal(repaired.child, first.child)
      assert.equal(require.cache[resolvedEntry].exports, repaired)
    `, preserveSymlinks ? ['--preserve-symlinks'] : [])
  }, 20000)
})
