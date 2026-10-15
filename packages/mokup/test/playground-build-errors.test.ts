import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import process from 'node:process'
import { writePlaygroundBuild } from '@mokup/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root: string
let outDir: string
let distDir: string
let siblingDir: string
let neighborDir: string
let logger: { error: ReturnType<typeof vi.fn>, warn: ReturnType<typeof vi.fn>, info: ReturnType<typeof vi.fn>, log: ReturnType<typeof vi.fn> }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mokup-playground-error-'))
  outDir = join(root, 'output')
  distDir = join(root, 'owned-assets')
  siblingDir = join(root, 'owned-sibling')
  neighborDir = join(root, 'output-neighbor')
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn() }
  await Promise.all([outDir, distDir, siblingDir, neighborDir].map(directory => mkdir(directory)))
  await Promise.all([root, outDir, siblingDir, neighborDir].map(directory =>
    writeFile(join(directory, 'sentinel.txt'), 'original fixture data'),
  ))
  await writeFile(join(distDir, 'index.html'), '<html><head></head><body>Owned Playground fixture</body></html>')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function build(playgroundPath: string, output = outDir, assets = distDir) {
  await writePlaygroundBuild({
    outDir: output,
    base: '/',
    playgroundPath,
    root,
    routes: [],
    disabledRoutes: [],
    ignoredRoutes: [],
    configFiles: [],
    disabledConfigFiles: [],
    dirs: [],
    swScript: null,
    logger,
    resolvePlaygroundDist: () => assets,
  })
}

async function expectFixturePreserved() {
  for (const directory of [root, outDir, siblingDir, neighborDir]) {
    await expect(readFile(join(directory, 'sentinel.txt'), 'utf8')).resolves.toBe('original fixture data')
    await expect(access(join(directory, 'index.html'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(directory, 'routes'))).rejects.toMatchObject({ code: 'ENOENT' })
  }
  await expect(readFile(join(distDir, 'index.html'), 'utf8')).resolves.toContain('Owned Playground fixture')
}

describe('playground build errors', () => {
  it.each([
    '/',
    '/.',
    '/nested/..',
    '/..',
    '/../owned-sibling',
    '/../output-neighbor',
    '/nested/../../owned-sibling',
    String.raw`/nested\..\..\owned-sibling`,
  ])('rejects output path %s before changing any fixture data', async (playgroundPath) => {
    await build(playgroundPath)

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Playground build path must be a strict subdirectory of the Vite outDir. Aborting output.',
    )
    await expectFixturePreserved()
  })

  it.each(['/', '/.', '/nested/..'])('rejects normalized root %s with a relative outDir ending in a dot', async (playgroundPath) => {
    // Keep even a broken writer inside this test's temporary directory.
    const relativeOutDir = `${relative(process.cwd(), outDir)}/.`
    await build(playgroundPath, relativeOutDir)

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Playground build path must be a strict subdirectory of the Vite outDir. Aborting output.',
    )
    await expectFixturePreserved()
  })

  it.each([
    { playgroundPath: '/linked/nested', dangling: false },
    { playgroundPath: '/linked', dangling: false },
    { playgroundPath: '/linked/nested', dangling: true },
    { playgroundPath: '/linked', dangling: true },
  ])('rejects a descendant link for $playgroundPath (dangling=$dangling)', async ({ playgroundPath, dangling }) => {
    const nestedSibling = join(siblingDir, 'nested')
    const link = join(outDir, 'linked')
    const linkTarget = dangling ? join(root, 'missing-sibling') : siblingDir
    await mkdir(nestedSibling)
    await writeFile(join(nestedSibling, 'sentinel.txt'), 'original nested data')
    await symlink(linkTarget, link, process.platform === 'win32' ? 'junction' : 'dir')

    await build(playgroundPath)

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Playground build path contains a symbolic link below the Vite outDir. Aborting output.',
    )
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    await expectFixturePreserved()
    await expect(readFile(join(nestedSibling, 'sentinel.txt'), 'utf8')).resolves.toBe('original nested data')
    await expect(access(join(nestedSibling, 'index.html'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(nestedSibling, 'routes'))).rejects.toMatchObject({ code: 'ENOENT' })
    if (dangling) {
      await expect(access(linkTarget)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('logs when playground assets are missing without changing existing output', async () => {
    const target = join(outDir, '__mokup')
    await mkdir(target)
    await writeFile(join(target, 'sentinel.txt'), 'previous Playground output')

    await build('/__mokup', outDir, join(root, 'missing-assets'))

    expect(logger.error).toHaveBeenCalledExactlyOnceWith('Failed to locate playground assets:', expect.any(Error))
    await expect(readFile(join(target, 'sentinel.txt'), 'utf8')).resolves.toBe('previous Playground output')
    await expectFixturePreserved()
  })
})

describe('playground build output boundaries', () => {
  it.each(['/nested/playground', '/nested/../playground', '/..cache'])('builds an ordinary descendant %s', async (playgroundPath) => {
    const target = join(outDir, playgroundPath)
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'obsolete.txt'), 'previous Playground output')

    await build(playgroundPath)

    expect(logger.error).not.toHaveBeenCalled()
    await expect(readFile(join(target, 'index.html'), 'utf8')).resolves.toContain('Owned Playground fixture')
    expect(JSON.parse(await readFile(join(target, 'routes'), 'utf8'))).toMatchObject({ count: 0, routes: [] })
    await expect(access(join(target, 'obsolete.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expectFixturePreserved()
  })

  it('allows the explicitly configured output root to be a directory link', async () => {
    const outputLink = join(root, 'linked-output')
    await symlink(outDir, outputLink, process.platform === 'win32' ? 'junction' : 'dir')

    await build('/nested/playground', outputLink)

    expect(logger.error).not.toHaveBeenCalled()
    expect((await lstat(outputLink)).isSymbolicLink()).toBe(true)
    await expect(readFile(join(outDir, 'nested/playground/index.html'), 'utf8')).resolves.toContain('Owned Playground fixture')
    expect(JSON.parse(await readFile(join(outDir, 'nested/playground/routes'), 'utf8'))).toMatchObject({ count: 0, routes: [] })
    await expectFixturePreserved()
  })
})
