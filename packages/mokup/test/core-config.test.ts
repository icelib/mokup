import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveDirectoryConfig } from '@mokup/core'
import { describe, expect, it, vi } from 'vitest'

async function createTempRoot() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-core-config-'))
  const mockDir = path.join(root, 'mock')
  await fs.mkdir(mockDir, { recursive: true })
  return { root, mockDir }
}

describe('core config resolver', () => {
  it('merges config sources and tracks origins', async () => {
    const { root, mockDir } = await createTempRoot()
    const usersDir = path.join(mockDir, 'users')
    const routeFile = path.join(usersDir, 'profile.get.json')
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    try {
      await fs.mkdir(usersDir, { recursive: true })
      await fs.writeFile(routeFile, '{}', 'utf8')
      await fs.writeFile(
        path.join(mockDir, 'index.config.js'),
        [
          'export default {',
          '  headers: { "x-root": "1" },',
          '  status: 201,',
          '  delay: 10,',
          '  enabled: true,',
          '  ignorePrefix: "_",',
          '  include: /users/,',
          '  exclude: /skip/,',
          '  middleware: [(c, next) => next()],',
          '}',
        ].join('\n'),
        'utf8',
      )
      await fs.writeFile(
        path.join(usersDir, 'index.config.js'),
        [
          'const symbol = Symbol.for("mokup.config.middlewares")',
          'export default {',
          '  [symbol]: {',
          '    pre: [() => {}, "bad"],',
          '    post: [() => {}],',
          '  },',
          '  headers: { "x-user": "2" },',
          '  delay: 5,',
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

      expect(config.headers).toEqual({ 'x-root': '1', 'x-user': '2' })
      expect(config.status).toBe(201)
      expect(config.delay).toBe(5)
      expect(config.enabled).toBe(true)
      expect(config.ignorePrefix).toBe('_')
      expect(config.configChain.length).toBe(2)
      expect(config.configSources.status).toContain('index.config.js')
      expect(config.configSources.delay).toContain('index.config.js')
      expect(config.middlewares.length).toBeGreaterThan(0)
      expect(logger.warn).toHaveBeenCalled()
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('warns on invalid config exports', async () => {
    const { root, mockDir } = await createTempRoot()
    const usersDir = path.join(mockDir, 'users')
    const routeFile = path.join(usersDir, 'profile.get.json')
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    try {
      await fs.mkdir(usersDir, { recursive: true })
      await fs.writeFile(routeFile, '{}', 'utf8')
      await fs.writeFile(
        path.join(mockDir, 'index.config.js'),
        'export default "invalid"',
        'utf8',
      )

      const config = await resolveDirectoryConfig({
        file: routeFile,
        rootDir: mockDir,
        logger,
        configCache: new Map(),
        fileCache: new Map(),
      })

      expect(config.configChain).toEqual([])
      expect(logger.warn).toHaveBeenCalled()
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('loads configs via Vite server and normalizes middlewares', async () => {
    const { root, mockDir } = await createTempRoot()
    const usersDir = path.join(mockDir, 'users')
    const routeFile = path.join(usersDir, 'profile.get.json')
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    try {
      await fs.mkdir(usersDir, { recursive: true })
      await fs.writeFile(routeFile, '{}', 'utf8')
      await fs.writeFile(path.join(mockDir, 'index.config.ts'), 'export default {}', 'utf8')

      const symbol = Symbol.for('mokup.config.middlewares')
      const configValue = {
        headers: { 'x-server': '1' },
        middleware: () => undefined,
        [symbol]: {
          normal: [() => undefined],
        },
      }
      const server = {
        moduleGraph: {
          resolveUrl: vi.fn().mockImplementation(async (id: string) => [id, id]),
          getModuleById: vi.fn().mockReturnValue(null),
          invalidateModule: vi.fn(),
        },
        ssrLoadModule: vi.fn().mockResolvedValue(configValue),
      }

      const config = await resolveDirectoryConfig({
        file: routeFile,
        rootDir: mockDir,
        logger,
        configCache: new Map(),
        fileCache: new Map(),
        server: server as never,
      })

      expect(config.headers).toEqual({ 'x-server': '1' })
      expect(config.middlewares.length).toBe(2)
      expect(server.ssrLoadModule).toHaveBeenCalled()
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('warns when Vite loader returns null and root is not an ancestor', async () => {
    const { root, mockDir } = await createTempRoot()
    const usersDir = path.join(mockDir, 'users')
    const routeFile = path.join(usersDir, 'profile.get.json')
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    try {
      await fs.mkdir(usersDir, { recursive: true })
      await fs.writeFile(routeFile, '{}', 'utf8')
      await fs.writeFile(path.join(mockDir, 'index.config.ts'), 'export default {}', 'utf8')

      const server = {
        moduleGraph: {
          resolveUrl: vi.fn().mockImplementation(async (id: string) => [id, id]),
          getModuleById: vi.fn().mockReturnValue(null),
          invalidateModule: vi.fn(),
        },
        ssrLoadModule: vi.fn().mockResolvedValue(null),
      }

      const config = await resolveDirectoryConfig({
        file: routeFile,
        rootDir: '/nonexistent-root',
        logger,
        configCache: new Map(),
        fileCache: new Map(),
        server: server as never,
      })

      expect(config.configChain).toEqual([])
      expect(logger.warn).toHaveBeenCalled()
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
