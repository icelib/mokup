import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMokupWebpackPlugin, mokupWebpack } from '../src/webpack'

const mocks = vi.hoisted(() => ({
  ensureBuilt: vi.fn(async () => {}),
  rebuildBundles: vi.fn(async () => {}),
  createLogger: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() }),
  normalizeMokupOptions: vi.fn((options: any) => options),
  normalizeOptions: vi.fn().mockReturnValue([
    { dir: '/root/mock', mode: 'sw', watch: true, log: true },
  ]),
  resolvePlaygroundOptions: vi.fn().mockReturnValue({ enabled: true, path: '/__mokup', build: true }),
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
  createMiddleware: vi.fn().mockReturnValue((_req: any, _res: any, next: () => void) => next()),
  createPlaygroundMiddleware: vi.fn().mockReturnValue((_req: any, _res: any, next: () => void) => next()),
  resolveDirs: vi.fn().mockReturnValue(['/root/mock']),
  createBundleBuilder: vi.fn().mockReturnValue({
    rebuildBundles: vi.fn(async () => {}),
    ensureBuilt: vi.fn(async () => {}),
  }),
  resolveHtmlWebpackPlugin: vi.fn().mockReturnValue(null),
  createRouteRefresher: vi.fn().mockReturnValue(vi.fn(async () => {})),
  createWebpackWatcher: vi.fn().mockReturnValue({ close: vi.fn() }),
  resolveAssetsDir: vi.fn().mockReturnValue('assets'),
  resolveBaseFromPublicPath: vi.fn().mockReturnValue('/'),
  resolveModuleFilePath: vi.fn().mockReturnValue('/virtual/module.mjs'),
  resolveRegisterPath: vi.fn((_base: string, path: string) => path),
  resolveRegisterScope: vi.fn((_base: string, scope: string) => scope),
}))

vi.mock('@mokup/core', () => ({
  createMiddleware: mocks.createMiddleware,
  createPlaygroundMiddleware: mocks.createPlaygroundMiddleware,
  resolvePlaygroundOptions: mocks.resolvePlaygroundOptions,
  resolveSwConfig: mocks.resolveSwConfig,
  resolveSwUnregisterConfig: mocks.resolveSwUnregisterConfig,
}))
vi.mock('../src/shared/logger', () => ({
  createLogger: mocks.createLogger,
}))
vi.mock('../src/shared/utils', () => ({
  resolveDirs: mocks.resolveDirs,
}))
vi.mock('../src/webpack/plugin/options', () => ({
  normalizeMokupOptions: mocks.normalizeMokupOptions,
  normalizeOptions: mocks.normalizeOptions,
}))
vi.mock('../src/webpack/plugin/bundles', () => ({
  createBundleBuilder: mocks.createBundleBuilder,
}))
vi.mock('../src/webpack/plugin/html', () => ({
  resolveHtmlWebpackPlugin: mocks.resolveHtmlWebpackPlugin,
}))
vi.mock('../src/webpack/plugin/refresh', () => ({
  createRouteRefresher: mocks.createRouteRefresher,
}))
vi.mock('../src/webpack/plugin/watcher', () => ({
  createWebpackWatcher: mocks.createWebpackWatcher,
}))
vi.mock('../src/webpack/plugin/paths', () => ({
  joinPublicPath: (base: string, file: string) => `${base}${file}`,
  resolveAssetsDir: mocks.resolveAssetsDir,
  resolveBaseFromPublicPath: mocks.resolveBaseFromPublicPath,
  resolveModuleFilePath: mocks.resolveModuleFilePath,
  resolveRegisterPath: mocks.resolveRegisterPath,
  resolveRegisterScope: mocks.resolveRegisterScope,
}))

describe('mokup webpack plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createLogger.mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() })
    mocks.normalizeMokupOptions.mockImplementation((options: any) => options)
    mocks.normalizeOptions.mockReturnValue([{ dir: '/root/mock', mode: 'sw', watch: true, log: true }])
    mocks.resolveSwConfig.mockImplementation(() => ({
      path: '/mokup-sw.js',
      scope: '/',
      register: true,
      unregister: false,
      basePaths: [],
    }))
    mocks.resolveSwUnregisterConfig.mockImplementation(() => ({
      path: '/mokup-sw.js',
      scope: '/',
      register: true,
      unregister: false,
      basePaths: [],
    }))
    mocks.createBundleBuilder.mockReturnValue({
      rebuildBundles: vi.fn(async () => {}),
      ensureBuilt: vi.fn(async () => {}),
    })
    mocks.createRouteRefresher.mockReturnValue(vi.fn(async () => {}))
  })

  it('creates a webpack plugin instance', () => {
    const plugin = createMokupWebpackPlugin({ entries: { dir: '/root/mock' } })

    expect(plugin).toHaveProperty('apply')
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

    createMokupWebpackPlugin({ entries: { dir: '/root/mock' } })

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

    expect(() => createMokupWebpackPlugin({
      entries: { dir: '/root/mock' },
      errorOn: ['sw-conflict'],
    })).toThrow(/Mokup diagnostics error: 1 service worker config conflicts/)
  })

  it('wraps webpack config with mokup plugin', () => {
    const withMokup = mokupWebpack({ entries: { dir: '/root/mock' } })
    const config = withMokup({ plugins: ['existing'] as any[], devServer: { port: 8080 } })

    expect(config.plugins).toHaveLength(2)
    expect(config.plugins?.[0]).toBe('existing')
    expect(config.plugins?.[1]).toHaveProperty('apply')
    expect(config.devServer).toEqual({ port: 8080 })
  })
})
