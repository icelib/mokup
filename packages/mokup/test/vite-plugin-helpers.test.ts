import { describe, expect, it, vi } from 'vitest'
import { transformMokupIndexHtml } from '../src/vite/plugin/html-transform'
import { loadMokupVirtualModule, resolveMokupVirtualId } from '../src/vite/plugin/virtual-modules'

const ids = {
  swVirtualId: 'virtual:mokup-sw',
  resolvedSwVirtualId: '\0virtual:mokup-sw',
  swLifecycleVirtualId: 'virtual:mokup-sw-lifecycle',
  resolvedSwLifecycleVirtualId: '\0virtual:mokup-sw-lifecycle',
  bundleVirtualId: 'virtual:mokup-bundle',
  resolvedBundleVirtualId: '\0virtual:mokup-bundle',
}

const swConfig = {
  path: '/mokup-sw.js',
  scope: '/',
  register: true,
  unregister: false,
  basePaths: [],
}

describe('vite plugin extracted helpers', () => {
  it('resolves known virtual module ids', () => {
    expect(resolveMokupVirtualId('virtual:mokup-sw', ids)).toBe('\0virtual:mokup-sw')
    expect(resolveMokupVirtualId('virtual:mokup-bundle', ids)).toBe('\0virtual:mokup-bundle')
    expect(resolveMokupVirtualId('other', ids)).toBeNull()
  })

  it('loads bundle virtual modules and registers watch files', async () => {
    const addWatchFile = vi.fn()
    const refreshRoutes = vi.fn(async () => {})
    const code = await loadMokupVirtualModule(
      {
        addWatchFile,
        resolve: vi.fn(),
      },
      ids.resolvedBundleVirtualId,
      {
        ids,
        command: 'serve',
        state: {
          lastSignature: null,
          serverRoutes: [{ file: '/root/mock/ping.ts', middlewares: [{ source: '/root/mock/mw.ts' }] }],
          configFiles: [{ file: '/root/mock/index.config.ts' }],
          disabledConfigFiles: [{ file: '/root/mock/index.disabled.ts' }],
          swRoutes: [],
          swModuleVersion: 1,
        } as any,
        currentServer: null,
        refreshRoutes,
        resolveAllDirs: () => ['/root/mock'],
        root: '/root',
        swConfig,
        unregisterConfig: swConfig,
        hasSwEntries: true,
        hasSwRoutes: () => true,
        resolveSwRequestPath: path => path,
        resolveSwRegisterScope: scope => scope,
        swLifecycleScript: null,
        setSwLifecycleScript: vi.fn(),
      },
    )

    expect(typeof code).toBe('string')
    expect(refreshRoutes).toHaveBeenCalledWith(undefined, { silent: true })
    expect(addWatchFile).toHaveBeenCalledWith('/root/mock')
    expect(addWatchFile).toHaveBeenCalledWith('/root/mock/ping.ts')
    expect(addWatchFile).toHaveBeenCalledWith('/root/mock/mw.ts')
  })

  it('transforms html for build and serve modes', async () => {
    const refreshRoutes = vi.fn(async () => {})

    const buildHtml = await transformMokupIndexHtml('<html></html>', {
      state: { swRoutes: [{}] },
      refreshRoutes,
      currentServer: null,
      command: 'build',
      base: '/base/',
      swConfig,
      unregisterConfig: swConfig,
      hasSwEntries: true,
      resolveSwImportPath: base => `${base}@id/mokup/sw`,
      resolveRequestPath: path => path,
      resolveRegisterScope: scope => scope,
      swLifecycleFileName: 'mokup-sw-lifecycle.js',
      swLifecycleImportPath: '/base/@id/__x00__virtual:mokup-sw-lifecycle',
      resolveHtmlAssetPath: file => `/base/${file}`,
    })
    expect(buildHtml).toEqual({
      html: '<html></html>',
      tags: [{ tag: 'script', attrs: { type: 'module', src: '/base/mokup-sw-lifecycle.js' }, injectTo: 'head' }],
    })

    const serveHtml = await transformMokupIndexHtml('<html></html>', {
      state: { swRoutes: [{}] },
      refreshRoutes,
      currentServer: null,
      command: 'serve',
      base: '/base/',
      swConfig,
      unregisterConfig: swConfig,
      hasSwEntries: true,
      resolveSwImportPath: base => `${base}@id/mokup/sw`,
      resolveRequestPath: path => path,
      resolveRegisterScope: scope => scope,
      swLifecycleFileName: null,
      swLifecycleImportPath: '/base/@id/__x00__virtual:mokup-sw-lifecycle',
      resolveHtmlAssetPath: file => `/base/${file}`,
    })
    expect(serveHtml).toEqual({
      html: '<html></html>',
      tags: [{ tag: 'script', attrs: { type: 'module', src: '/base/@id/__x00__virtual:mokup-sw-lifecycle' }, injectTo: 'head' }],
    })
  })

  it('registers SW routes discovered while transforming initially empty HTML', async () => {
    const state = { swRoutes: [] as unknown[] }
    const result = await transformMokupIndexHtml('<html></html>', {
      state,
      refreshRoutes: async () => { state.swRoutes = [{}] },
      currentServer: null,
      command: 'serve',
      base: '/',
      swConfig,
      unregisterConfig: swConfig,
      hasSwEntries: true,
      resolveSwImportPath: () => '/@id/mokup/sw',
      resolveRequestPath: path => path,
      resolveRegisterScope: scope => scope,
      swLifecycleFileName: null,
      swLifecycleImportPath: '/@id/__x00__virtual:mokup-sw-lifecycle',
      resolveHtmlAssetPath: path => path,
    })
    expect(result).toMatchObject({ tags: [{ attrs: { src: '/@id/__x00__virtual:mokup-sw-lifecycle' } }] })
  })
})
