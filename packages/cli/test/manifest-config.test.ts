import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDirectoryConfig } from '../src/manifest/config'
import { toPosix } from '../src/manifest/utils'

async function createTempRoot() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-cli-config-'))
  const mockDir = path.join(root, 'mock')
  await fs.mkdir(mockDir, { recursive: true })
  return { root, mockDir }
}

async function cleanupTempRoot(root: string) {
  await fs.rm(root, { recursive: true, force: true })
}

describe('resolveDirectoryConfig', () => {
  it('merges config chain and normalizes middleware', async () => {
    const { root, mockDir } = await createTempRoot()
    const usersDir = path.join(mockDir, 'users')
    const routeFile = path.join(usersDir, 'profile.get.json')
    try {
      await fs.mkdir(usersDir, { recursive: true })
      await fs.writeFile(routeFile, '{}', 'utf8')
      await fs.writeFile(
        path.join(mockDir, 'index.config.js'),
        [
          'export default {',
          '  headers: { "x-root": "1" },',
          '  status: 201,',
          '  delay: 50,',
          '  include: /root/,',
          '  ignorePrefix: ".",',
          '  middleware: [async (_req, _res, _ctx, next) => { await next() }],',
          '}',
        ].join('\n'),
        'utf8',
      )
      await fs.writeFile(
        path.join(usersDir, 'index.config.js'),
        [
          'export default {',
          '  headers: { "x-user": "2" },',
          '  status: 404,',
          '  delay: 10,',
          '  enabled: false,',
          '  include: /users/,',
          '  exclude: /skip/,',
          '  ignorePrefix: "_",',
          '  middleware: async (_req, _res, _ctx, next) => { await next() },',
          '}',
        ].join('\n'),
        'utf8',
      )

      const config = await resolveDirectoryConfig({
        file: routeFile,
        rootDir: mockDir,
        configCache: new Map(),
        fileCache: new Map(),
      })

      expect(config.headers).toEqual({ 'x-root': '1', 'x-user': '2' })
      expect(config.status).toBe(404)
      expect(config.delay).toBe(10)
      expect(config.enabled).toBe(false)
      expect(config.include?.source).toBe('users')
      expect(config.exclude?.source).toBe('skip')
      expect(config.ignorePrefix).toBe('_')
      expect(config.middlewares).toHaveLength(2)
      expect(config.middlewares[0]?.position).toBe('normal')
      expect(config.middlewares[1]?.position).toBe('normal')
      expect(toPosix(config.middlewares[0]?.file ?? '')).toBe(
        toPosix(path.join(mockDir, 'index.config.js')),
      )
      expect(toPosix(config.middlewares[1]?.file ?? '')).toBe(
        toPosix(path.join(usersDir, 'index.config.js')),
      )
    }
    finally {
      await cleanupTempRoot(root)
    }
  })

  it('logs invalid config files and middleware entries', async () => {
    const { root, mockDir } = await createTempRoot()
    const usersDir = path.join(mockDir, 'users')
    const routeFile = path.join(usersDir, 'profile.get.json')
    const logs: string[] = []
    try {
      await fs.mkdir(usersDir, { recursive: true })
      await fs.writeFile(routeFile, '{}', 'utf8')
      await fs.writeFile(
        path.join(mockDir, 'index.config.js'),
        [
          'export default {',
          '  headers: { "x-root": "1" },',
          '  middleware: [',
          '    async (_req, _res, _ctx, next) => { await next() },',
          '    "invalid",',
          '  ],',
          '}',
        ].join('\n'),
        'utf8',
      )
      await fs.writeFile(
        path.join(usersDir, 'index.config.js'),
        'export default "invalid"',
        'utf8',
      )

      const config = await resolveDirectoryConfig({
        file: routeFile,
        rootDir: mockDir,
        log: message => logs.push(message),
        configCache: new Map(),
        fileCache: new Map(),
      })

      expect(config.headers).toEqual({ 'x-root': '1' })
      expect(config.middlewares).toHaveLength(1)
      expect(config.middlewares[0]?.position).toBe('normal')
      expect(logs.some(message => message.includes('Invalid config'))).toBe(true)
      expect(logs.some(message => message.includes('Invalid middleware'))).toBe(true)
    }
    finally {
      await cleanupTempRoot(root)
    }
  })

  it('reads middleware meta and preserves positions', async () => {
    const { root, mockDir } = await createTempRoot()
    const routeFile = path.join(mockDir, 'users.get.json')
    try {
      await fs.writeFile(routeFile, '{}', 'utf8')
      await fs.writeFile(
        path.join(mockDir, 'index.config.js'),
        [
          'const meta = {',
          '  pre: [async (_req, _res, _ctx, next) => { await next() }],',
          '  normal: [async (_req, _res, _ctx, next) => { await next() }],',
          '  post: [async (_req, _res, _ctx, next) => { await next() }],',
          '}',
          'export default {',
          '  [Symbol.for(\"mokup.config.middlewares\")]: meta,',
          '}',
        ].join('\n'),
        'utf8',
      )

      const config = await resolveDirectoryConfig({
        file: routeFile,
        rootDir: mockDir,
        configCache: new Map(),
        fileCache: new Map(),
      })

      expect(config.middlewares.map(entry => entry.position)).toEqual([
        'pre',
        'normal',
        'post',
      ])
    }
    finally {
      await cleanupTempRoot(root)
    }
  })

  it('loads cjs and ts configs and normalizes middleware meta', async () => {
    const { root, mockDir } = await createTempRoot()
    try {
      const cjsDir = path.join(mockDir, 'cjs')
      const tsDir = path.join(mockDir, 'ts')
      await fs.mkdir(cjsDir, { recursive: true })
      await fs.mkdir(tsDir, { recursive: true })
      const cjsRoute = path.join(cjsDir, 'cjs.get.json')
      const tsRoute = path.join(tsDir, 'ts.get.json')
      await fs.writeFile(cjsRoute, '{}', 'utf8')
      await fs.writeFile(tsRoute, '{}', 'utf8')
      await fs.writeFile(
        path.join(cjsDir, 'index.config.cjs'),
        'module.exports = { headers: { \"x-cjs\": \"1\" } }',
        'utf8',
      )
      await fs.writeFile(
        path.join(tsDir, 'index.config.ts'),
        [
          'const meta = { pre: \"nope\", normal: 1, post: null }',
          'export default {',
          '  headers: { \"x-ts\": \"1\" },',
          '  [Symbol.for(\"mokup.config.middlewares\")]: meta,',
          '}',
        ].join('\n'),
        'utf8',
      )

      const cjsConfig = await resolveDirectoryConfig({
        file: cjsRoute,
        rootDir: mockDir,
        configCache: new Map(),
        fileCache: new Map(),
      })
      expect(cjsConfig.headers).toEqual({ 'x-cjs': '1' })

      const tsConfig = await resolveDirectoryConfig({
        file: tsRoute,
        rootDir: mockDir,
        configCache: new Map(),
        fileCache: new Map(),
      })
      expect(tsConfig.headers).toEqual({ 'x-ts': '1' })
      expect(tsConfig.middlewares).toEqual([])
    }
    finally {
      await cleanupTempRoot(root)
    }
  })

  it('logs invalid cached config paths and tolerates missing roots', async () => {
    const { root, mockDir } = await createTempRoot()
    const logs: string[] = []
    try {
      const routeFile = path.join(mockDir, 'route.get.json')
      await fs.writeFile(routeFile, '{}', 'utf8')
      const fileCache = new Map<string, string | null>()
      const cachedPath = path.join(mockDir, 'index.config.txt')
      fileCache.set(toPosix(mockDir), cachedPath)

      await resolveDirectoryConfig({
        file: routeFile,
        rootDir: path.join(root, 'not-root'),
        log: message => logs.push(message),
        configCache: new Map(),
        fileCache,
      })

      expect(logs).toContain(`Invalid config in ${cachedPath}`)
    }
    finally {
      await cleanupTempRoot(root)
    }
  })
})
