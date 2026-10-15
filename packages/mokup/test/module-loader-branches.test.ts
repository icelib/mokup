import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(async () => {
  const { resetModuleLoaderForTests } = await import('@mokup/shared/module-loader')
  resetModuleLoaderForTests()
  vi.resetModules()
  vi.clearAllMocks()
  vi.doUnmock('node:fs')
  vi.doUnmock('node:url')
  vi.doUnmock('tsx/esm/api')
})

describe('module loader branches', () => {
  it('handles missing workspace entries and unsupported extensions', async () => {
    const existsSync = vi.fn().mockReturnValue(false)
    const register = vi.fn()
    const dir = await fs.mkdtemp(join(tmpdir(), 'mokup-module-branches-'))
    const valueFile = join(dir, 'value.mjs')
    const sourceFile = join(dir, 'mock.ts')
    await fs.writeFile(valueFile, 'export const value = "ts"', 'utf8')
    await fs.writeFile(sourceFile, 'export const value = "ts"', 'utf8')
    await fs.writeFile(join(dir, 'package.json'), '{"type":"module"}')

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
      return { ...actual, existsSync }
    })

    vi.doMock('node:url', async () => {
      const actual = await vi.importActual<typeof import('node:url')>('node:url')
      return {
        ...actual,
        pathToFileURL: () => actual.pathToFileURL(valueFile),
      }
    })

    vi.doMock('tsx/esm/api', () => ({
      register,
    }))

    vi.resetModules()
    const { loadModule } = await import('@mokup/core')

    try {
      const tsMod = await loadModule(sourceFile)
      expect(tsMod?.value).toBe('ts')
      expect(register).toHaveBeenCalledTimes(1)
      const [options] = register.mock.calls[0] ?? []
      expect(options).toBeUndefined()

      const unknown = await loadModule('/tmp/mock.txt')
      expect(unknown).toBeNull()
    }
    finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
