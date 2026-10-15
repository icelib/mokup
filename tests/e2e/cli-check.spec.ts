import type { CheckResult } from 'mokup/cli'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { execa } from 'execa'
import { repoRoot } from './utils/paths'

const cliPath = join(repoRoot, 'packages/mokup/dist/cli-bin.mjs')

async function writeFixture(root: string, file: string, contents: string) {
  const target = join(root, file)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, contents)
}

async function check(root: string, args: string[] = []) {
  const result = await execa(process.execPath, [cliPath, 'check', '--json', ...args], {
    cwd: root,
    env: { FORCE_COLOR: undefined, NO_COLOR: '1' },
    reject: false,
    timeout: 30_000,
  })
  expect(result.stderr).toBe('')
  return { exitCode: result.exitCode, report: JSON.parse(result.stdout) as CheckResult }
}

test('mokup check counts real handlers without invoking them or changing output', async ({ request: _request }, testInfo) => {
  const root = testInfo.outputPath('check-project')
  await writeFixture(root, 'mock/static.get.json', '{ "ok": true }')
  await writeFixture(root, 'mock/dynamic.post.ts', 'export default () => { throw new Error("handler invoked") }')
  await writeFixture(root, 'mock/index.config.ts', 'export default { middleware: () => { throw new Error("middleware invoked") } }')
  const files = await readdir(root, { recursive: true })

  expect(await check(root)).toEqual({
    exitCode: 0,
    report: { schemaVersion: 1, valid: true, routeCount: 2, diagnostics: [] },
  })
  expect(await readdir(root, { recursive: true })).toEqual(files)

  await writeFixture(root, '.mokup/mokup.manifest.json', 'existing output')
  expect((await check(root)).exitCode).toBe(0)
  expect(await readFile(join(root, '.mokup/mokup.manifest.json'), 'utf8')).toBe('existing output')
})

test('mokup check reports diagnostics and applies the selected failure categories', async ({ request: _request }, testInfo) => {
  const root = testInfo.outputPath('check-diagnostics')
  await writeFixture(root, 'mock/ping.get.json', '{}')
  await writeFixture(root, 'mock/ping.get.ts', 'export default { handler: {} }')
  await writeFixture(root, 'mock/invalid.ts', 'export default {}')

  const failed = await check(root, ['--prefix', '/api'])
  expect(failed.exitCode).toBe(1)
  expect(failed.report).toMatchObject({ schemaVersion: 1, valid: false, routeCount: 2 })
  expect(failed.report.diagnostics).toEqual([
    expect.objectContaining({ category: 'invalid-route', count: 1, items: ['mock/invalid.ts'] }),
    expect.objectContaining({ category: 'duplicate-route', count: 1, items: ['GET /api/ping'] }),
  ])

  const selected = await check(root, ['--prefix', '/api', '--error-on', 'missing-handler'])
  expect(selected.exitCode).toBe(0)
  expect(selected.report).toEqual({ ...failed.report, valid: true })
  expect(await readdir(root)).toEqual(['mock'])
})

for (const failure of ['missing-directory', 'invalid-json', 'import-error']) {
  test(`mokup check emits a JSON failure for ${failure}`, async ({ request: _request }, testInfo) => {
    const root = testInfo.outputPath(failure)
    await mkdir(root, { recursive: true })
    if (failure === 'invalid-json') {
      await writeFixture(root, 'mock/broken.get.json', '{ "broken": }')
    }
    if (failure === 'import-error') {
      await writeFixture(root, 'mock/broken.get.mjs', 'throw new Error("mock import failed")')
    }

    const result = await check(root)
    expect(result.exitCode).toBe(1)
    expect(result.report).toEqual({
      schemaVersion: 1,
      valid: false,
      routeCount: 0,
      diagnostics: [],
      error: { message: expect.any(String) },
    })
    expect(result.report.error?.message).toContain({
      'missing-directory': 'Cannot read mock directory',
      'invalid-json': 'Invalid JSONC',
      'import-error': 'mock import failed',
    }[failure])
    expect(await readdir(root)).not.toContain('.mokup')
  })
}
