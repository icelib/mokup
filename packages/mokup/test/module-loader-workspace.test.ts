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

describe('module loader workspace config', () => {
  it('writes tsx config with workspace src paths when available', async () => {
    vi.resetModules()
    const register = vi.fn()
    const writes: string[] = []
    const dir = await fs.mkdtemp(join(tmpdir(), 'mokup-module-workspace-'))
    const valueFile = join(dir, 'value.mjs')
    const sourceFile = join(dir, 'mock.ts')
    await fs.writeFile(valueFile, 'export const value = 1', 'utf8')
    await fs.writeFile(sourceFile, 'export const value = 1', 'utf8')
    await fs.writeFile(join(dir, 'package.json'), '{"type":"module"}')

    vi.doMock('node:url', async () => {
      const actual = await vi.importActual<typeof import('node:url')>('node:url')
      return {
        ...actual,
        fileURLToPath: () => '/virtual/core/dist/module-loader.mjs',
        pathToFileURL: () => actual.pathToFileURL(valueFile),
      }
    })

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
      return {
        ...actual,
        existsSync: (input: string) => {
          const normalized = input.replace(/\\/g, '/')
          return normalized.startsWith('/virtual/mokup/')
            && (normalized.endsWith('/src/index.ts') || normalized.endsWith('/src/vite.ts'))
        },
        writeFileSync: (_path: string, data: string) => {
          writes.push(data)
        },
      }
    })

    vi.doMock('tsx/esm/api', () => ({
      register,
    }))

    try {
      const { loadModule } = await import('@mokup/core')
      const mod = await loadModule(sourceFile)

      expect(mod?.value).toBe(1)
      expect(register).toHaveBeenCalledTimes(1)
      const [options] = register.mock.calls[0] ?? []
      expect(options).toMatchObject({ tsconfig: expect.any(String) })

      expect(writes).toHaveLength(1)
      const config = JSON.parse(writes[0] as string)
      expect(config.compilerOptions.baseUrl).toBe('/virtual/core')
      expect(config.compilerOptions.paths.mokup).toEqual(['../mokup/src/index.ts'])
      expect(config.compilerOptions.paths['mokup/vite']).toEqual(['../mokup/src/vite.ts'])
    }
    finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
