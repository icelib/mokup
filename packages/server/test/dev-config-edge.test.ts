import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { toPosix } from '@mokup/shared/path-utils'
import { describe, expect, it, vi } from 'vitest'
import { resolveDirectoryConfig } from '../src/dev/config'

async function createTempRoot() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-dev-config-edge-'))
  const mockDir = path.join(root, 'mock')
  await fs.mkdir(mockDir, { recursive: true })
  return { root, mockDir }
}

describe('dev config edge cases', () => {
  it('handles normal middlewares from metadata', async () => {
    const { root, mockDir } = await createTempRoot()
    const routeFile = path.join(mockDir, 'users.get.json')
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    try {
      await fs.writeFile(routeFile, '{}', 'utf8')
      await fs.writeFile(
        path.join(mockDir, 'index.config.js'),
        [
          'const symbol = Symbol.for("mokup.config.middlewares")',
          'export default {',
          '  [symbol]: {',
          '    normal: [() => {}],',
          '  },',
          '}',
        ].join('\n'),
        'utf8',
      )

      const config = await resolveDirectoryConfig({
        file: routeFile,
        rootDir: mockDir,
        logger,
        configCache: new Map(),
        fileCache: new Map(),
      })

      expect(config.middlewares.length).toBe(1)
      expect(config.middlewares[0]?.position).toBe('normal')
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('returns empty config when cached file is unsupported', async () => {
    const { root, mockDir } = await createTempRoot()
    const routeFile = path.join(mockDir, 'users.get.json')
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    try {
      await fs.writeFile(routeFile, '{}', 'utf8')
      const cachedPath = path.join(mockDir, 'index.config.txt')
      await fs.writeFile(cachedPath, 'invalid', 'utf8')

      const fileCache = new Map([[toPosix(mockDir), cachedPath]])
      const config = await resolveDirectoryConfig({
        file: routeFile,
        rootDir: mockDir,
        logger,
        configCache: new Map(),
        fileCache,
      })

      expect(config.headers).toBeUndefined()
      expect(logger.warn).toHaveBeenCalledWith(`Invalid config in ${cachedPath}`)
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('handles roots that are not ancestors', async () => {
    const { root, mockDir } = await createTempRoot()
    const outsideFile = path.join(root, 'outside', 'users.get.json')
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    try {
      await fs.mkdir(path.dirname(outsideFile), { recursive: true })
      await fs.writeFile(outsideFile, '{}', 'utf8')

      const config = await resolveDirectoryConfig({
        file: outsideFile,
        rootDir: mockDir,
        logger,
        configCache: new Map(),
        fileCache: new Map(),
      })

      expect(config.middlewares).toEqual([])
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
