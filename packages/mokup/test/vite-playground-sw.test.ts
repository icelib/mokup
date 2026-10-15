import type { ResolvedSwConfig } from '@mokup/core'
import type { PreviewServer, ViteDevServer } from 'vite'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveRegisterPath, resolveRegisterScope } from '../src/vite/plugin/paths'
import { buildPlaygroundSwLifecycleScript } from '../src/vite/plugin/playground-sw'

let root: string
let outDir: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mokup-playground-sw-'))
  outDir = join(root, 'output')
  await mkdir(outDir)
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeWorker(file = 'mokup-sw.js') {
  const target = join(outDir, file)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, 'self.addEventListener("fetch", () => {})')
  return target
}

function script(options: {
  server?: 'dev' | 'preview' | 'none'
  base?: string
  hasSwRoutes?: boolean
  sw?: Partial<ResolvedSwConfig> | null
  unregister?: Partial<ResolvedSwConfig>
} = {}) {
  const base = options.base ?? '/workspace/'
  const defaults: ResolvedSwConfig = {
    path: '/mokup-sw.js',
    scope: '/',
    register: true,
    unregister: false,
    basePaths: [],
  }
  const swConfig = options.sw === null ? null : { ...defaults, ...options.sw }
  const server = options.server === 'none'
    ? null
    : { config: { root, base }, ...(options.server === 'dev' ? { ws: {} } : {}) } as ViteDevServer | PreviewServer
  return buildPlaygroundSwLifecycleScript({
    server,
    outDir,
    base,
    swConfig,
    unregisterConfig: { ...defaults, ...options.unregister },
    hasSwEntries: !!swConfig,
    hasSwRoutes: options.hasSwRoutes ?? false,
    resolveRequestPath: path => resolveRegisterPath(base, path),
    resolveRegisterScope: scope => resolveRegisterScope(base, scope),
  })
}

describe('Playground service worker lifecycle', () => {
  it('registers an existing preview worker after every source route has been removed', async () => {
    await writeWorker()

    const output = script({ hasSwRoutes: false })
    expect(output).toContain('navigator.serviceWorker.register(path, { type: \'module\', scope })')
    expect(output).toContain('const path = "/workspace/mokup-sw.js"')
    expect(output).toContain('const scope = "/workspace/"')
    expect(output).not.toMatch(/@id|@vite\/client|import\.meta\.hot|^import /m)
  })

  it('does not register source-only routes or mistake a directory for a built worker', async () => {
    expect(script({ hasSwRoutes: true })).toBeNull()
    await mkdir(join(outDir, 'mokup-sw.js'))
    expect(script({ hasSwRoutes: true })).toBeNull()
  })

  it('rechecks the worker on each request after artifacts are created or removed', async () => {
    expect(script()).toBeNull()
    const worker = await writeWorker()
    expect(script()).toContain('navigator.serviceWorker.register')
    await rm(worker)
    expect(script()).toBeNull()
  })

  it('honors current registration settings without needing a built lifecycle asset', async () => {
    await writeWorker()

    expect(script({ sw: { register: false } })).toBeNull()
    expect(script({ sw: { register: true } })).toContain('navigator.serviceWorker.register')
    expect(script({ sw: null })).toBeNull()
  })

  it.each([null, { register: false }])('prioritizes current unregister intent without any worker artifact (%j)', (sw) => {
    const output = script({ sw, unregister: { unregister: true, path: '/previous-sw.js', scope: '/old' } })

    expect(output).toContain('navigator.serviceWorker.getRegistrations()')
    expect(output).toContain('await registration.unregister()')
    expect(output).toContain('const path = "/workspace/previous-sw.js"')
    expect(output).toContain('const scope = "/workspace/old"')
    expect(output).not.toContain('navigator.serviceWorker.register(')
  })

  it('preserves dev module imports and live route gating independently of build artifacts', async () => {
    const output = script({ server: 'dev', hasSwRoutes: true })
    expect(output).toContain('from "/workspace/@id/mokup/sw"')
    expect(output).toContain('import.meta.hot')

    await writeWorker()
    expect(script({ server: 'dev', hasSwRoutes: false })).toBeNull()
    expect(script({ server: 'none', hasSwRoutes: true })).toBeNull()
  })
})

describe('preview worker artifact URL mapping', () => {
  it.each([
    { base: '/', path: '/mokup-sw.js', file: 'mokup-sw.js', request: '/mokup-sw.js' },
    { base: '/workspace/', path: '/nested/mokup-sw.js', file: 'nested/mokup-sw.js', request: '/workspace/nested/mokup-sw.js' },
    { base: '/workspace/', path: '/workspace/mokup-sw.js', file: 'mokup-sw.js', request: '/workspace/mokup-sw.js' },
    { base: '/workspace/', path: '/worker%20script.js', file: 'worker script.js', request: '/workspace/worker%20script.js' },
    { base: '/workspace/', path: '/worker%2Fscript.js', file: 'worker%2Fscript.js', request: '/workspace/worker%2Fscript.js' },
    { base: '/workspace/', path: '/mokup-sw.js?version=built', file: 'mokup-sw.js', request: '/workspace/mokup-sw.js?version=built' },
  ])('checks the file Vite serves for $request', async ({ base, path, file, request }) => {
    await writeWorker(file)

    expect(script({ base, sw: { path } })).toContain(`const path = ${JSON.stringify(request)}`)
  })

  it('does not mistake a duplicated base directory for the requested worker', async () => {
    await writeWorker('workspace/mokup-sw.js')

    expect(script({ sw: { path: '/workspace/mokup-sw.js' } })).toBeNull()
  })

  it('keeps encoded reserved separators literal, matching Vite decodeURI behavior', async () => {
    await writeWorker('worker/script.js')

    expect(script({ sw: { path: '/worker%2Fscript.js' } })).toBeNull()
  })

  it('does not look outside the configured output directory', async () => {
    await writeFile(join(root, 'owned-worker.js'), 'self.skipWaiting()')

    expect(script({ sw: { path: '/../owned-worker.js' } })).toBeNull()
    expect(script({ sw: { path: '/%2e%2e/owned-worker.js' } })).toBeNull()
    expect(script({ base: '/', sw: { path: '/%5C..%5Cowned-worker.js' } })).toBeNull()
  })

  it('treats a non-directory parent as a missing worker', async () => {
    await writeWorker('not-a-directory')

    expect(script({ sw: { path: '/not-a-directory/mokup-sw.js' } })).toBeNull()
  })
})
