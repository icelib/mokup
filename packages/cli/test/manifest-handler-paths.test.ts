import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { bundleHandlers, getHandlerModulePath } from '../src/manifest/handlers'

describe('handler output paths', () => {
  const root = path.resolve('handler-path-fixture/app')
  const handlers = path.join(root, 'dist/mokup-handlers')

  it('preserves internal names that start with two dots', () => {
    expect(getHandlerModulePath(path.join(root, '..fixtures/ping.get.ts'), handlers, root))
      .toBe('./mokup-handlers/..fixtures/ping.get.mjs')
  })

  it('distinguishes external source extensions and unsafe filename characters', () => {
    const modules = ['ping.get.ts', 'ping.get.mjs', 'quote\'#%.get.ts'].map(file =>
      getHandlerModulePath(path.resolve(root, '../shared', file), handlers, root),
    )
    expect(new Set(modules).size).toBe(3)
    for (const module of modules) {
      expect(module).toMatch(/^\.\/mokup-handlers\/_external\/[a-f0-9]+\.mjs$/)
    }
  })

  it('rejects internal names that normalize to the same output before bundling', async () => {
    await expect(bundleHandlers([
      path.join(root, 'mock/[id].get.ts'),
      path.join(root, 'mock/_id_.get.ts'),
    ], root, handlers)).rejects.toThrow('Handler output path collision')
  })

  it('rejects a local source colliding with an external output name', async () => {
    const external = path.resolve(root, '../shared/ping.get.ts')
    const module = getHandlerModulePath(external, handlers, root)
    const local = path.join(root, module.replace('./mokup-handlers/', '').replace(/\.mjs$/, '.ts'))
    await expect(bundleHandlers([external, local], root, handlers))
      .rejects
      .toThrow('Handler output path collision')
  })

  it.runIf(process.platform === 'win32')('keeps cross-drive and UNC sources inside the output directory', () => {
    for (const [windowsRoot, source] of [
      ['C:\\app', 'D:\\shared\\ping.get.ts'],
      ['\\\\server\\share\\app', '\\\\server\\share\\shared\\ping.get.ts'],
      ['\\\\server\\share\\app', '\\\\other\\share\\shared\\ping.get.ts'],
    ] as const) {
      const output = path.join(windowsRoot, 'dist/mokup-handlers')
      const module = getHandlerModulePath(source, output, windowsRoot)
      expect(module).toMatch(/^\.\/mokup-handlers\/_external\/[a-f0-9]+\.mjs$/)
    }
  })
})
