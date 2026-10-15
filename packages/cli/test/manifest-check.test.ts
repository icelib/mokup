import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildManifest, checkManifest } from '../src/index'
import { loadRules } from '../src/manifest/rules'

describe('checkManifest', () => {
  let root: string

  async function writeMock(file: string, contents: string) {
    const target = path.join(root, 'mock', file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, contents, 'utf8')
    return target
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-check-'))
    await fs.mkdir(path.join(root, 'mock'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('counts static and function routes without invoking handlers or writing output', async () => {
    await writeMock('index.config.mjs', 'export default { middleware: () => { throw new Error("middleware invoked") } }')
    await writeMock('static.get.json', '{ "ok": true }')
    await writeMock('dynamic.post.ts', 'export default () => { throw new Error("handler invoked") }')
    const before = await fs.readdir(root, { recursive: true })

    expect(await checkManifest({ root })).toEqual({
      schemaVersion: 1,
      valid: true,
      routeCount: 2,
      diagnostics: [],
    })
    expect(await fs.readdir(root, { recursive: true })).toEqual(before)
  })

  it('reports all route diagnostics with unique, sorted, relative items', async () => {
    await writeMock('z.ts', 'export default {}')
    await writeMock('a.ts', 'export default {}')
    await writeMock('missing.get.mjs', 'export default [{}, {}]')
    await writeMock('legacy.get.mjs', 'export default { handler: {}, response: {} }')
    await writeMock('duplicate.get.json', '{}')
    await writeMock('duplicate.get.mjs', 'export default [{ handler: {} }, { handler: {} }]')

    const result = await checkManifest({ root })

    expect(result.valid).toBe(false)
    expect(result.routeCount).toBe(3)
    expect(result.diagnostics.map(({ category, count, items }) => ({ category, count, items }))).toEqual([
      { category: 'invalid-route', count: 2, items: ['mock/a.ts', 'mock/z.ts'] },
      { category: 'unsupported-fields', count: 1, items: ['mock/legacy.get.mjs'] },
      { category: 'missing-handler', count: 1, items: ['mock/missing.get.mjs'] },
      { category: 'duplicate-route', count: 1, items: ['GET /duplicate'] },
    ])
    expect(result.diagnostics.every(section => section.label && section.advice)).toBe(true)
    expect(await checkManifest({ root })).toEqual(result)
    expect(await fs.readdir(root)).toEqual(['mock'])
  })

  it('allows selected failures and report-only mode without discarding diagnostics', async () => {
    await writeMock('missing.get.mjs', 'export default {}')

    const defaults = await checkManifest({ root })
    const matching = await checkManifest({ root, errorOn: ['missing-handler'] })
    const unrelated = await checkManifest({ root, errorOn: ['duplicate-route'] })
    const reportOnly = await checkManifest({ root, errorOn: [] })

    expect(defaults.valid).toBe(false)
    expect(matching.valid).toBe(false)
    expect(unrelated.valid).toBe(true)
    expect(reportOnly.valid).toBe(true)
    expect(matching.diagnostics).toEqual(defaults.diagnostics)
    expect(unrelated.diagnostics).toEqual(defaults.diagnostics)
    expect(reportOnly.diagnostics).toEqual(defaults.diagnostics)
  })

  it('uses inherited directory filters and ignores disabled or excluded invalid input', async () => {
    await writeMock('index.config.mjs', 'export default { include: /keep/, exclude: /skip/, ignorePrefix: "_" }')
    await writeMock('keep.get.json', '{}')
    await writeMock('skip-keep.get.json', 'invalid JSON')
    await writeMock('_keep.get.json', 'invalid JSON')
    await writeMock('disabled/index.config.mjs', 'export default { enabled: false }')
    await writeMock('disabled/keep.get.json', 'invalid JSON')
    await writeMock('keep-disabled.get.mjs', 'export default { enabled: false, handler: {} }')

    const options = { root, include: /nothing/, exclude: /keep/, ignorePrefix: '.' }
    const checked = await checkManifest(options)
    const built = await buildManifest({ ...options, outDir: 'output', handlers: false })

    expect(checked).toEqual({ schemaVersion: 1, valid: true, routeCount: 1, diagnostics: [] })
    expect(built.manifest.routes.map(route => route.url)).toEqual(['/keep'])
  })

  it('applies global filters and checks each configured mock directory', async () => {
    await writeMock('keep.get.json', '{}')
    await writeMock('skip.get.json', 'invalid JSON')
    await fs.mkdir(path.join(root, 'other'))
    await fs.writeFile(path.join(root, 'other', 'keep.get.json'), '{}')

    const result = await checkManifest({ root, dir: ['mock', 'other'], include: /keep/, prefix: '/api' })

    expect(result.routeCount).toBe(2)
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ category: 'duplicate-route', items: ['GET /api/keep'] }),
    ])
  })

  it.each(['g', 'y'])('returns the same report when reusing %s filter options', async (flags) => {
    await writeMock('broken.get.mjs', 'export default {}')
    const include = new RegExp('.*broken\\.get\\.mjs$', flags)
    include.lastIndex = 7
    const options = { root, include }

    const first = await checkManifest(options)
    const second = await checkManifest(options)

    expect(first.valid).toBe(false)
    expect(first.diagnostics).toEqual([
      expect.objectContaining({ category: 'missing-handler', items: ['mock/broken.get.mjs'] }),
    ])
    expect(second).toEqual(first)
    expect(include.lastIndex).toBe(7)
  })

  it('reports an invalid resolved prefix while preserving permissive build behavior', async () => {
    await writeMock('ping.get.json', '{}')

    const result = await checkManifest({ root, prefix: '/(group)' })
    const built = await buildManifest({ root, prefix: '/(group)', errorOn: 'all' })

    expect(result.valid).toBe(false)
    expect(result.routeCount).toBe(0)
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ category: 'invalid-route', items: ['mock/ping.get.json'] }),
    ])
    expect(built.manifest.routes).toEqual([])
  })

  it('accepts an empty directory or routes that are all excluded', async () => {
    expect(await checkManifest({ root })).toEqual({
      schemaVersion: 1,
      valid: true,
      routeCount: 0,
      diagnostics: [],
    })
    await writeMock('ignored.get.json', 'invalid JSON')
    expect(await checkManifest({ root, exclude: /ignored/ })).toEqual({
      schemaVersion: 1,
      valid: true,
      routeCount: 0,
      diagnostics: [],
    })
  })

  it('rejects missing default and explicit directories without changing build behavior', async () => {
    await fs.rm(path.join(root, 'mock'), { recursive: true })

    await expect(checkManifest({ root })).rejects.toThrow(/Cannot read mock directory "mock"/)
    await expect(checkManifest({ root, dir: 'missing', errorOn: [] })).rejects.toThrow(/Cannot read mock directory "missing"/)
    await expect(buildManifest({ root })).resolves.toMatchObject({ manifest: { routes: [] } })
  })

  it('rejects a path that is not a directory', async () => {
    await fs.writeFile(path.join(root, 'not-a-directory'), '{}')

    await expect(checkManifest({ root, dir: 'not-a-directory' })).rejects.toThrow(/not a directory/)
    expect(await fs.readdir(root)).not.toContain('.mokup')
  })

  it.each(['json', 'jsonc'])('rejects malformed %s while builds keep skipping it', async (extension) => {
    await writeMock(`broken.get.${extension}`, '{ "broken": }')

    await expect(checkManifest({ root, errorOn: [] })).rejects.toThrow(/Invalid JSONC/)
    expect(await fs.readdir(root)).toEqual(['mock'])
    await expect(buildManifest({ root })).resolves.toMatchObject({ manifest: { routes: [] } })
  })

  it('rejects selected JSON read failures in strict input mode', async () => {
    const missing = path.join(root, 'mock', 'missing.get.json')

    await expect(loadRules(missing, { strict: true })).rejects.toThrow(/Failed to read/)
    await expect(loadRules(missing)).resolves.toEqual([])
  })

  it('propagates module-loading errors without writing output', async () => {
    await writeMock('broken.get.mjs', 'throw new Error("mock import failed")')

    await expect(checkManifest({ root })).rejects.toThrow('mock import failed')
    expect(await fs.readdir(root)).toEqual(['mock'])
  })

  it('preserves the build contract of writing artifacts before strict diagnostic errors', async () => {
    await writeMock('missing.get.mjs', 'export default {}')

    await expect(buildManifest({ root, errorOn: 'all' })).rejects.toThrow(/Mokup diagnostics error/)
    const manifest = JSON.parse(await fs.readFile(path.join(root, '.mokup', 'mokup.manifest.json'), 'utf8'))
    expect(manifest).toEqual({ version: 1, routes: [] })
    expect(await fs.readFile(path.join(root, '.mokup', 'mokup.bundle.mjs'), 'utf8')).toContain('export default mokupBundle')
  })
})
