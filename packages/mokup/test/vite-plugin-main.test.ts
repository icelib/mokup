import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMokupPlugin } from '../src/vite/plugin'

const mocks = vi.hoisted(() => {
  const refreshRoutes = vi.fn()
  const _refresh = vi.fn(async () => {})
  return {
    refreshRoutes,
    buildBundleModule: vi.fn().mockReturnValue('bundle-code'),
    createPlaygroundMiddleware: vi.fn().mockReturnValue((_req: any, _res: any, next: () => void) => next()),
    resolvePlaygroundOptions: vi.fn().mockReturnValue({ enabled: true, path: '/__mokup', build: true }),
    writePlaygroundBuild: vi.fn(),
    buildSwScript: vi.fn().mockReturnValue('sw-code'),
    resolveSwConfig: vi.fn().mockReturnValue({
      path: '/mokup-sw.js',
      scope: '/',
      register: true,
      unregister: false,
      basePaths: [],
    }),
    resolveSwUnregisterConfig: vi.fn().mockReturnValue({
      path: '/mokup-sw.js',
      scope: '/',
      register: true,
      unregister: false,
      basePaths: [],
    }),
    createLogger: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() }),
    normalizeMokupOptions: vi.fn((options: any) => options),
    normalizeOptions: vi.fn().mockReturnValue([
      { dir: '/root/mock', mode: 'sw', watch: true, log: true },
    ]),
    resolveSwImportPath: vi.fn().mockReturnValue('/@id/mokup/sw'),
    createRouteRefresher: vi.fn().mockImplementation((params: any) => {
      return async (server?: unknown, options?: unknown) => {
        refreshRoutes(server, options)
        params.state.routes = [
          { file: '/root/mock/ping.get.ts', template: '/ping', method: 'GET', tokens: [], score: [], handler: { ok: true } },
        ]
        params.state.serverRoutes = [
          { file: '/root/mock/ping.get.ts', template: '/ping', method: 'GET', tokens: [], score: [], handler: { ok: true } },
        ]
        params.state.swRoutes = [
          { file: '/root/mock/ping.get.ts', template: '/ping', method: 'GET', tokens: [], score: [], handler: { ok: true } },
        ]
        params.state.configFiles = [{ file: '/root/mock/index.config.ts' }]
        params.state.disabledConfigFiles = []
        params.state.lastSignature = 'sig'
      }
    }),
    createDirResolver: vi.fn().mockReturnValue(() => ['/root/mock']),
    createHtmlAssetResolver: vi.fn().mockReturnValue({
      resolveHtmlAssetPath: (fileName: string) => `/base/${fileName}`,
      resolveAssetsFileName: (fileName: string) => fileName,
    }),
    createSwPathResolver: vi.fn().mockReturnValue({
      resolveSwRequestPath: (path: string) => path,
      resolveSwRegisterScope: (scope: string) => scope,
    }),
    configureDevServer: vi.fn(),
    configurePreviewServer: vi.fn().mockResolvedValue({ close: vi.fn() }),
    buildSwLifecycleInlineScript: vi.fn().mockReturnValue('inline-script'),
    buildSwLifecycleScript: vi.fn().mockReturnValue('lifecycle-script'),
    resolveSwModuleImport: vi.fn().mockResolvedValue('/resolved/sw.mjs'),
  }
})

vi.mock('@mokup/core', () => ({
  buildBundleModule: mocks.buildBundleModule,
  createPlaygroundMiddleware: mocks.createPlaygroundMiddleware,
  resolvePlaygroundOptions: mocks.resolvePlaygroundOptions,
  writePlaygroundBuild: mocks.writePlaygroundBuild,
  buildSwScript: mocks.buildSwScript,
  resolveSwConfig: mocks.resolveSwConfig,
  resolveSwUnregisterConfig: mocks.resolveSwUnregisterConfig,
}))
vi.mock('../src/shared/logger', () => ({
  createLogger: mocks.createLogger,
}))
vi.mock('../src/vite/plugin/options', () => ({
  normalizeMokupOptions: mocks.normalizeMokupOptions,
  normalizeOptions: mocks.normalizeOptions,
}))
vi.mock('../src/vite/plugin/paths', async importOriginal => ({
  ...await importOriginal<typeof import('../src/vite/plugin/paths')>(),
  resolveSwImportPath: mocks.resolveSwImportPath,
}))
vi.mock('../src/vite/plugin/refresh', () => ({
  createRouteRefresher: mocks.createRouteRefresher,
}))
vi.mock('../src/vite/plugin/resolvers', () => ({
  createDirResolver: mocks.createDirResolver,
  createHtmlAssetResolver: mocks.createHtmlAssetResolver,
  createSwPathResolver: mocks.createSwPathResolver,
}))
vi.mock('../src/vite/plugin/server-hooks', () => ({
  configureDevServer: mocks.configureDevServer,
  configurePreviewServer: mocks.configurePreviewServer,
}))
vi.mock('../src/vite/plugin/sw', () => ({
  buildSwLifecycleInlineScript: mocks.buildSwLifecycleInlineScript,
  buildSwLifecycleScript: mocks.buildSwLifecycleScript,
  resolveSwModuleImport: mocks.resolveSwModuleImport,
}))

describe('mokup vite plugin', () => {
  beforeEach(() => {
    mocks.refreshRoutes.mockClear()
  })

  it('resolves virtual ids and loads bundle', async () => {
    const plugin = createMokupPlugin({ entries: { dir: '/root/mock' } })
    const resolveId = plugin.resolveId?.('virtual:mokup-bundle')
    expect(resolveId).toBe('\0virtual:mokup-bundle')

    const addWatchFile = vi.fn()
    const code = await plugin.load?.call({ addWatchFile } as any, resolveId as string)

    expect(code).toBe('bundle-code')
    expect(addWatchFile).toHaveBeenCalled()
    expect(mocks.buildBundleModule).toHaveBeenCalled()
    expect(mocks.refreshRoutes).toHaveBeenCalled()
    expect(mocks.refreshRoutes.mock.calls[0]?.[1]).toEqual({ silent: true })
  })

  it('loads sw lifecycle and sw script', async () => {
    const plugin = createMokupPlugin({ entries: { dir: '/root/mock' } })
    const swLifecycleId = plugin.resolveId?.('virtual:mokup-sw-lifecycle') as string
    const swId = plugin.resolveId?.('virtual:mokup-sw') as string

    const lifecycle = await plugin.load?.call({ addWatchFile: vi.fn() } as any, swLifecycleId)
    expect(lifecycle).toBe('lifecycle-script')
    expect(mocks.resolveSwModuleImport).toHaveBeenCalled()

    const sw = await plugin.load?.call({ addWatchFile: vi.fn() } as any, swId)
    expect(sw).toBe('sw-code')
  })

  it('emits lifecycle and sw assets in build', async () => {
    const plugin = createMokupPlugin({ entries: { dir: '/root/mock' } })
    plugin.configResolved?.({
      root: '/root',
      base: '/base/',
      command: 'build',
      build: { assetsDir: 'assets', outDir: 'dist', ssr: false },
    } as any)

    const emitFile = vi.fn()
    await plugin.buildStart?.call({ emitFile } as any)

    expect(emitFile).toHaveBeenCalledWith({
      type: 'chunk',
      id: 'virtual:mokup-sw-lifecycle',
      fileName: 'mokup-sw-lifecycle.js',
    })
  })

  it('injects lifecycle scripts into HTML', async () => {
    const plugin = createMokupPlugin({ entries: { dir: '/root/mock' } })
    plugin.configResolved?.({
      root: '/root',
      base: '/base/',
      command: 'build',
      build: { assetsDir: 'assets', outDir: 'dist', ssr: false },
    } as any)

    await plugin.buildStart?.call({ emitFile: vi.fn() } as any)
    const buildHtml = await plugin.transformIndexHtml?.('<html></html>')
    expect(buildHtml).toEqual({
      html: '<html></html>',
      tags: [
        { tag: 'script', attrs: { type: 'module', src: '/base/mokup-sw-lifecycle.js' }, injectTo: 'head' },
      ],
    })

    plugin.configResolved?.({
      root: '/root',
      base: '/base/',
      command: 'serve',
      build: { assetsDir: 'assets', outDir: 'dist', ssr: false },
    } as any)
    const serveHtml = await plugin.transformIndexHtml?.('<html></html>')
    expect(serveHtml).toEqual({
      html: '<html></html>',
      tags: [
        { tag: 'script', attrs: { type: 'module', src: '/base/@id/__x00__virtual:mokup-sw-lifecycle' }, injectTo: 'head' },
      ],
    })
  })

  it('configures servers and writes playground builds', async () => {
    const plugin = createMokupPlugin({ entries: { dir: '/root/mock' }, playground: true })
    plugin.configResolved?.({
      root: '/root',
      base: '/base/',
      command: 'build',
      build: { assetsDir: 'assets', outDir: 'dist', ssr: false },
    } as any)

    await plugin.configureServer?.({} as any)
    expect(mocks.configureDevServer).toHaveBeenCalled()

    const httpServer = { once: vi.fn() }
    await plugin.configurePreviewServer?.({ httpServer } as any)
    expect(mocks.configurePreviewServer).toHaveBeenCalled()

    await plugin.closeBundle?.()
    expect(mocks.writePlaygroundBuild).toHaveBeenCalled()
  })

  it('prints a service worker conflict summary', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() }
    mocks.createLogger.mockReturnValueOnce(logger)
    mocks.resolveSwConfig.mockImplementationOnce((_options: any, configLogger: any) => {
      configLogger.warn('SW path "/other.js" ignored; using "/mokup-sw.js".')
      configLogger.warn('SW scope "/other" ignored; using "/".')
      return {
        path: '/mokup-sw.js',
        scope: '/',
        register: true,
        unregister: false,
        basePaths: [],
      }
    })

    createMokupPlugin({ entries: { dir: '/root/mock' } })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Mokup diagnostics summary: 2 service worker config conflicts'),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Fix: Align sw.path, sw.scope, sw.register, and sw.unregister'),
    )
  })

  it('throws when service worker conflicts are promoted to errors', () => {
    mocks.resolveSwConfig.mockImplementationOnce((_options: any, configLogger: any) => {
      configLogger.warn('SW path "/other.js" ignored; using "/mokup-sw.js".')
      return {
        path: '/mokup-sw.js',
        scope: '/',
        register: true,
        unregister: false,
        basePaths: [],
      }
    })

    expect(() => createMokupPlugin({
      entries: { dir: '/root/mock' },
      errorOn: ['sw-conflict'],
    })).toThrow(/Mokup diagnostics error: 1 service worker config conflicts/)
  })

  it('returns empty lifecycle output when script is null and defaults are used', async () => {
    mocks.buildSwLifecycleScript.mockReturnValueOnce(null)
    const plugin = createMokupPlugin({ entries: { dir: '/root/mock' } })
    plugin.configResolved?.({
      root: '/root',
      base: undefined,
      command: 'serve',
      build: { assetsDir: undefined, outDir: undefined, ssr: false },
    } as any)

    const swLifecycleId = plugin.resolveId?.('virtual:mokup-sw-lifecycle') as string
    const lifecycle = await plugin.load?.call({ addWatchFile: vi.fn() } as any, swLifecycleId)
    expect(lifecycle).toBe('')
  })

  it('returns html in build when lifecycle filename is missing', async () => {
    const plugin = createMokupPlugin({ entries: { dir: '/root/mock' } })
    plugin.configResolved?.({
      root: '/root',
      base: '/base/',
      command: 'build',
      build: { assetsDir: 'assets', outDir: 'dist', ssr: false },
    } as any)

    const output = await plugin.transformIndexHtml?.('<html></html>')
    expect(output).toBe('<html></html>')
  })

  it('uses empty base paths when SW config is missing', async () => {
    mocks.resolveSwConfig.mockReturnValueOnce(null)
    const plugin = createMokupPlugin({ entries: { dir: '/root/mock' } })
    const swId = plugin.resolveId?.('virtual:mokup-sw') as string

    const result = await plugin.load?.call({ addWatchFile: vi.fn() } as any, swId)
    expect(result).toBe('sw-code')
    expect(mocks.buildSwScript).toHaveBeenCalledWith(
      expect.objectContaining({ basePaths: [] }),
    )
  })
})
