import type { Manifest } from '@mokup/runtime'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { buildManifest } from '../src/index'

const execFileAsync = promisify(execFile)
const fetchModuleUrl = pathToFileURL(createRequire(import.meta.url).resolve('@mokup/server/fetch')).href
const directories = ['.', '../shared-a', '../shared-b']
const scenarios = [
  { directory: 'app', file: 'ping.get.ts', url: '/ping', origin: 'local' },
  { directory: 'shared-a', file: 'a/ping.get.ts', url: '/a/ping', origin: 'a' },
  { directory: 'shared-b', file: 'b/ping.get.ts', url: '/b/ping', origin: 'b' },
]

async function writeFixture(directory: string) {
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'package.json'), '{"type":"module"}\n')
  for (const scenario of scenarios) {
    const mockDir = path.join(directory, scenario.directory)
    const handlerFile = path.join(mockDir, scenario.file)
    const origin = JSON.stringify(scenario.origin)
    await fs.mkdir(path.dirname(handlerFile), { recursive: true })
    await fs.writeFile(handlerFile, [
      'export default {',
      `  handler: c => c.json({ origin: ${origin}, scopes: c.get('scopes') }),`,
      '}',
    ].join('\n'))
    await fs.writeFile(path.join(mockDir, 'index.config.ts'), [
      'export default {',
      '  middleware: async (c, next) => {',
      `    c.set('scopes', [...(c.get('scopes') ?? []), ${origin}])`,
      '    await next()',
      `    c.header('x-scope', ${origin})`,
      '  },',
      '}',
    ].join('\n'))
  }
}

function expectWithin(directory: string, filename: string) {
  const relative = path.relative(directory, filename)
  expect(path.isAbsolute(relative)).toBe(false)
  expect(relative).not.toBe('..')
  expect(relative.startsWith(`..${path.sep}`)).toBe(false)
}

function collectReferences(manifest: Manifest) {
  return manifest.routes.map((route) => {
    if (route.response.type !== 'module') {
      throw new Error(`Expected a bundled function for ${route.url}`)
    }
    expect(route.middleware).toHaveLength(1)
    const middleware = route.middleware?.[0]?.module
    if (!middleware) {
      throw new Error(`Expected bundled middleware for ${route.url}`)
    }
    return { url: route.url, handler: route.response.module, middleware }
  }).sort((left, right) => left.url.localeCompare(right.url))
}

async function executeBundle(outDir: string) {
  const bundleUrl = pathToFileURL(path.join(outDir, 'mokup.bundle.mjs')).href
  // No TS loader or Vitest transform participates in loading the emitted graph.
  const source = `
    const { default: bundle } = await import(${JSON.stringify(bundleUrl)})
    const { createFetchHandler } = await import(${JSON.stringify(fetchModuleUrl)})
    const handler = createFetchHandler({ ...bundle, onNotFound: 'response' })
    const responses = []
    for (const pathname of ${JSON.stringify(scenarios.map(scenario => scenario.url))}) {
      const response = await handler(new Request('http://localhost' + pathname))
      responses.push({
        url: pathname,
        status: response.status,
        scope: response.headers.get('x-scope'),
        body: await response.json(),
      })
    }
    process.stdout.write(JSON.stringify({ modulePaths: Object.keys(bundle.moduleMap).sort(), responses }))
  `
  const { stdout } = await execFileAsync(process.execPath, [
    '--unhandled-rejections=strict',
    '--input-type=module',
    '-e',
    source,
  ], { timeout: 15_000, maxBuffer: 1024 * 1024 })
  const result = JSON.parse(stdout) as { modulePaths: string[], responses: unknown[] }
  expect(result.responses).toEqual(scenarios.map(scenario => ({
    url: scenario.url,
    status: 200,
    scope: scenario.origin,
    body: { origin: scenario.origin, scopes: [scenario.origin] },
  })))
  return result.modulePaths
}

async function buildAndCheck(directory: string, entries: string[]) {
  const root = path.join(directory, 'app')
  const outDir = path.join(root, 'dist')
  const handlersDir = path.join(outDir, 'mokup-handlers')
  const before = new Set(await fs.readdir(directory, { recursive: true }))
  const { manifest } = await buildManifest({ root, dir: entries, outDir: 'dist' })
  const references = collectReferences(manifest)
  expect(references.map(reference => reference.url)).toEqual(['/a/ping', '/b/ping', '/ping'])
  expect(references.find(reference => reference.url === '/ping')).toEqual({
    url: '/ping',
    handler: './mokup-handlers/ping.get.mjs',
    middleware: './mokup-handlers/index.config.mjs',
  })

  const modulePaths = references.flatMap(reference => [reference.handler, reference.middleware]).sort()
  expect(new Set(modulePaths).size).toBe(6)
  const realHandlersDir = await fs.realpath(handlersDir)
  for (const modulePath of modulePaths) {
    const target = path.resolve(outDir, modulePath)
    expectWithin(handlersDir, target)
    expectWithin(realHandlersDir, await fs.realpath(target))
    expect((await fs.stat(target)).isFile()).toBe(true)
  }
  for (const filename of await fs.readdir(directory, { recursive: true })) {
    if (!before.has(filename)) {
      expectWithin(outDir, path.join(directory, filename))
    }
  }
  expect(await executeBundle(outDir)).toEqual(modulePaths)
  return references
}

describe('external handler bundles', () => {
  it('executes same-named handlers and middleware with stable, contained output paths', async () => {
    const temporary = await fs.mkdtemp(path.join(tmpdir(), 'mokup-external-handlers-'))
    const original = path.join(temporary, 'original')
    const relocated = path.join(temporary, 'relocated', 'nested project')
    try {
      await writeFixture(original)
      const initial = await buildAndCheck(original, directories)

      // Remove generated routes before scanning '.', keeping both builds equivalent.
      await fs.rm(path.join(original, 'app', 'dist'), { recursive: true, force: true })
      expect(await buildAndCheck(original, [...directories].reverse())).toEqual(initial)

      // Existing artifacts must run after relocation without accessing the old tree.
      await fs.mkdir(path.dirname(relocated), { recursive: true })
      await fs.cp(original, relocated, { recursive: true })
      await fs.rm(original, { recursive: true, force: true })
      const modulePaths = initial.flatMap(reference => [reference.handler, reference.middleware]).sort()
      expect(await executeBundle(path.join(relocated, 'app', 'dist'))).toEqual(modulePaths)

      await fs.rm(path.join(relocated, 'app', 'dist'), { recursive: true, force: true })
      expect(await buildAndCheck(relocated, directories)).toEqual(initial)
    }
    finally {
      await fs.rm(temporary, { recursive: true, force: true })
    }
  }, 60_000)
})
