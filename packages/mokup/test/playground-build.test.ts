import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { writePlaygroundBuild } from '@mokup/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const playgroundDist = fileURLToPath(new URL('../../playground/dist', import.meta.url))
let root: string
let mockDir: string
let outDir: string
let fixtureDist: string
let logger: { error: ReturnType<typeof vi.fn>, warn: ReturnType<typeof vi.fn>, info: ReturnType<typeof vi.fn>, log: ReturnType<typeof vi.fn> }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mokup-playground-build-'))
  mockDir = join(root, 'mock')
  outDir = join(root, 'dist')
  fixtureDist = join(root, 'owned-assets')
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() }
  await Promise.all([mockDir, outDir, fixtureDist].map(directory => mkdir(directory)))
  await writeFile(join(fixtureDist, 'index.html'), '<html><head></head><body>Owned Playground fixture</body></html>')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function buildAtPath(base: string, playgroundPath: string) {
  await writePlaygroundBuild({
    outDir,
    base,
    playgroundPath,
    root,
    routes: [],
    disabledRoutes: [],
    ignoredRoutes: [],
    configFiles: [],
    disabledConfigFiles: [],
    dirs: [mockDir],
    swScript: null,
    logger,
    resolvePlaygroundDist: () => fixtureDist,
  })
}

describe('playground build output', () => {
  it('writes a playground bundle with routes payload', async () => {
    const routes = [
      {
        file: join(mockDir, 'users.get.json'),
        template: '/api/users',
        method: 'GET',
        tokens: [{ type: 'static', value: 'api' }, { type: 'static', value: 'users' }],
        score: [4, 5],
        handler: { ok: true },
        headers: { 'x-test': '1' },
        status: 200,
      },
    ]
    const disabledRoutes = [
      {
        file: join(mockDir, 'disabled.get.ts'),
        reason: 'disabled',
        method: 'GET',
        url: '/api/disabled',
      },
    ]
    const ignoredRoutes = [
      {
        file: join(mockDir, 'ignored.txt'),
        reason: 'unsupported',
      },
    ]

    await writePlaygroundBuild({
      outDir,
      base: '/',
      playgroundPath: '/__mokup',
      root,
      routes,
      disabledRoutes,
      ignoredRoutes,
      configFiles: [{ file: join(mockDir, 'index.config.ts') }],
      disabledConfigFiles: [{ file: join(mockDir, 'disabled.config.ts') }],
      dirs: [mockDir],
      swScript: null,
      logger,
      resolvePlaygroundDist: () => playgroundDist,
    })

    const routesPayload = await readFile(join(outDir, '__mokup', 'routes'), 'utf8')
    const parsed = JSON.parse(routesPayload) as {
      count: number
      routes: unknown[]
      disabledConfigs: unknown[]
    }
    expect(parsed.count).toBe(1)
    expect(parsed.routes.length).toBe(1)
    expect(parsed.disabledConfigs.length).toBe(1)
  })

  it('injects the service worker script into index.html', async () => {
    await writePlaygroundBuild({
      outDir,
      base: '/',
      playgroundPath: '/__mokup',
      root,
      routes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      dirs: [mockDir],
      swScript: 'console.log("sw")',
      logger,
      resolvePlaygroundDist: () => playgroundDist,
    })

    const indexHtml = await readFile(join(outDir, '__mokup', 'index.html'), 'utf8')
    expect(indexHtml).toContain('mokup-playground-sw')
    expect(indexHtml).toContain('console.log("sw")')
  })

  it.each([
    { base: '/workspace/', playgroundPath: '/__mokup', directory: '__mokup', basePath: '/workspace/__mokup' },
    { base: '/workspace/', playgroundPath: '/workspace/__mokup', directory: '__mokup', basePath: '/workspace/__mokup' },
    { base: '/workspace/apps', playgroundPath: '/workspace/apps/tools/mock/', directory: 'tools/mock', basePath: '/workspace/apps/tools/mock' },
    { base: '/workspace/', playgroundPath: '/workspace-other/__mokup', directory: 'workspace-other/__mokup', basePath: '/workspace/workspace-other/__mokup' },
  ])('maps $playgroundPath under base $base to the static output directory', async ({ base, playgroundPath, directory, basePath }) => {
    await buildAtPath(base, playgroundPath)

    expect(logger.error).not.toHaveBeenCalled()
    const target = join(outDir, directory)
    await expect(readFile(join(target, 'index.html'), 'utf8')).resolves.toContain('Owned Playground fixture')
    expect(JSON.parse(await readFile(join(target, 'routes'), 'utf8'))).toMatchObject({ basePath, count: 0, routes: [] })
    await expect(access(join(outDir, 'workspace'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['/workspace', '/workspace/', '/workspace/../owned-sibling'])('rejects unsafe output %s after removing the public base', async (playgroundPath) => {
    const sibling = join(root, 'owned-sibling')
    await mkdir(sibling)
    await Promise.all([outDir, sibling].map(directory => writeFile(join(directory, 'sentinel.txt'), 'original fixture data')))

    await buildAtPath('/workspace/', playgroundPath)

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Playground build path must be a strict subdirectory of the Vite outDir. Aborting output.',
    )
    for (const directory of [outDir, sibling]) {
      await expect(readFile(join(directory, 'sentinel.txt'), 'utf8')).resolves.toBe('original fixture data')
      await expect(access(join(directory, 'index.html'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(join(directory, 'routes'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await expect(access(join(outDir, 'workspace'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('checks descendant links after removing the public base', async () => {
    const sibling = join(root, 'owned-sibling')
    const nested = join(sibling, 'nested')
    const link = join(outDir, 'linked')
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, 'sentinel.txt'), 'original fixture data')
    await symlink(sibling, link, process.platform === 'win32' ? 'junction' : 'dir')

    await buildAtPath('/workspace/', '/workspace/linked/nested')

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Playground build path contains a symbolic link below the Vite outDir. Aborting output.',
    )
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    await expect(readFile(join(nested, 'sentinel.txt'), 'utf8')).resolves.toBe('original fixture data')
    await expect(access(join(nested, 'index.html'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(nested, 'routes'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(outDir, 'workspace'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
