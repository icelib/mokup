import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import type { MokupPluginOptions } from '../shared/types'
import type { PluginState } from './plugin/state'
import { cwd } from 'node:process'
import {
  collectSwConflictDiagnosticWarning,
  createSwConflictDiagnosticSections,
  reportDiagnostics,
} from '@mokup/shared/diagnostics'
import { resolve } from '@mokup/shared/pathe'
import { createPlaygroundMiddleware, resolvePlaygroundOptions, resolveSwConfig, resolveSwUnregisterConfig, writePlaygroundBuild } from '../internal/core'
import { resolvePlaygroundDist } from '../playground/assets'
import { createLogger } from '../shared/logger'
import { transformMokupIndexHtml } from './plugin/html-transform'
import { normalizeMokupOptions, normalizeOptions } from './plugin/options'
import { resolveRegisterPath, resolveSwImportPath, resolveSwOutputFileName } from './plugin/paths'
import { buildPlaygroundSwLifecycleScript } from './plugin/playground-sw'
import { createRouteRefresher } from './plugin/refresh'
import { createDirResolver, createHtmlAssetResolver, createSwPathResolver } from './plugin/resolvers'
import { configureDevServer, configurePreviewServer } from './plugin/server-hooks'
import { createServerSessions } from './plugin/server-session'
import { buildSwLifecycleInlineScript, buildSwLifecycleScript } from './plugin/sw'
import { loadMokupVirtualModule, resolveMokupVirtualId } from './plugin/virtual-modules'

export function createMokupPlugin(options: MokupPluginOptions = {}): Plugin {
  let root = cwd()
  let base = '/'
  let command: 'serve' | 'build' = 'serve'
  let assetsDir = 'assets'
  let outDir = 'dist'
  let isSsrBuild = false
  const state: PluginState = {
    routes: [],
    serverRoutes: [],
    swRoutes: [],
    disabledRoutes: [],
    ignoredRoutes: [],
    configFiles: [],
    disabledConfigFiles: [],
    app: null,
    lastSignature: null,
    lastDiagnosticsSignature: null,
    swModuleVersion: 0,
  }
  let currentServer: ViteDevServer | PreviewServer | null = null
  const normalizedOptions = normalizeMokupOptions(options)
  const runtime = normalizedOptions.runtime ?? 'node'
  const enableViteMiddleware = runtime !== 'worker'
  const optionList = normalizeOptions(normalizedOptions)
  const logEnabled = optionList.every(entry => entry.log !== false)
  const watchEnabled = optionList.every(entry => entry.watch !== false)
  const playgroundConfig = resolvePlaygroundOptions(normalizedOptions.playground)
  const logger = createLogger(logEnabled)
  const swConflictMessages: string[] = []
  const configLogger = {
    ...logger,
    warn: (...args: unknown[]) => {
      if (args.length > 0) {
        collectSwConflictDiagnosticWarning({
          message: args.map(String).join(' '),
          onConflict: value => swConflictMessages.push(value),
        })
      }
      logger.warn(...args)
    },
  }
  const hasSwEntries = optionList.some(entry => entry.mode === 'sw')
  const swConfig = resolveSwConfig(optionList, configLogger)
  const unregisterConfig = resolveSwUnregisterConfig(optionList, configLogger)
  const { error: swDiagnosticError } = reportDiagnostics({
    ...(normalizedOptions.errorOn ? { errorOn: normalizedOptions.errorOn } : {}),
    sections: createSwConflictDiagnosticSections(swConflictMessages),
    warn: message => logger.warn(message),
  })
  if (swDiagnosticError) {
    throw swDiagnosticError
  }
  const hasAutoSwRegistration = !!swConfig && swConfig.register !== false && !unregisterConfig.unregister
  const hasServerEntries = optionList.some(entry => entry.mode !== 'sw' || entry.sw?.fallback !== false)
  const resolveAllDirs = createDirResolver(optionList, () => root)
  const hasSwRoutes = () => !!swConfig && state.swRoutes.length > 0
  const { resolveSwRequestPath, resolveSwRegisterScope } = createSwPathResolver(() => base)
  const { resolveHtmlAssetPath, resolveAssetsFileName } = createHtmlAssetResolver(() => base, () => assetsDir)
  const swVirtualId = 'virtual:mokup-sw'
  const resolvedSwVirtualId = `\0${swVirtualId}`
  const swLifecycleVirtualId = 'virtual:mokup-sw-lifecycle'
  const resolvedSwLifecycleVirtualId = `\0${swLifecycleVirtualId}`
  const bundleVirtualId = 'virtual:mokup-bundle'
  const resolvedBundleVirtualId = `\0${bundleVirtualId}`
  let swLifecycleFileName: string | null = null
  let swLifecycleScript: string | null = null
  const playgroundMiddleware = createPlaygroundMiddleware({
    getRoutes: () => state.routes,
    getDisabledRoutes: () => state.disabledRoutes,
    getIgnoredRoutes: () => state.ignoredRoutes,
    getConfigFiles: () => state.configFiles,
    getDisabledConfigFiles: () => state.disabledConfigFiles,
    config: playgroundConfig,
    logger,
    getServer: () => currentServer,
    getDirs: () => resolveAllDirs(),
    getSwScript: () => buildPlaygroundSwLifecycleScript({
      server: currentServer,
      outDir,
      base,
      swConfig,
      unregisterConfig,
      hasSwEntries,
      hasSwRoutes: hasSwRoutes(),
      resolveRequestPath: resolveSwRequestPath,
      resolveRegisterScope: resolveSwRegisterScope,
    }),
    resolvePlaygroundDist,
  })
  const refreshRouteParams: Parameters<typeof createRouteRefresher>[0] = {
    state,
    optionList,
    root: () => root,
    logger,
    enableViteMiddleware,
    virtualModuleIds: [resolvedBundleVirtualId],
    // Browser-only routes already have an automatic SW updater. Preserve that
    // page and its update queue unless a server bundle also needs refreshing.
    reloadOnChange: runtime === 'worker' && (hasServerEntries || !hasAutoSwRegistration),
    reloadOnFirstSwRoute: hasAutoSwRegistration,
    ...(normalizedOptions.errorOn ? { errorOn: normalizedOptions.errorOn } : {}),
  }
  const scanRoutes = createRouteRefresher(refreshRouteParams)
  const sessions = createServerSessions({
    refresh: scanRoutes,
    onError: error => logger.error('Mock route refresh failed:', error),
    onServerChange: (server) => { currentServer = server },
  })
  const refreshRoutes: typeof scanRoutes = (server, refreshOptions) => command === 'build'
    ? scanRoutes(server, refreshOptions)
    : sessions.refresh(server, refreshOptions)
  return {
    name: 'mokup:vite',
    enforce: 'pre',
    resolveId(id) {
      return resolveMokupVirtualId(id, {
        swVirtualId,
        resolvedSwVirtualId,
        swLifecycleVirtualId,
        resolvedSwLifecycleVirtualId,
        bundleVirtualId,
        resolvedBundleVirtualId,
      })
    },
    async load(id) {
      return loadMokupVirtualModule(this, id, {
        ids: {
          swVirtualId,
          resolvedSwVirtualId,
          swLifecycleVirtualId,
          resolvedSwLifecycleVirtualId,
          bundleVirtualId,
          resolvedBundleVirtualId,
        },
        command,
        state,
        currentServer,
        refreshRoutes,
        resolveAllDirs,
        root,
        swConfig,
        unregisterConfig,
        hasSwEntries,
        hasSwRoutes,
        resolveSwRequestPath,
        resolveSwRegisterScope,
        swLifecycleScript,
        setSwLifecycleScript: (value) => { swLifecycleScript = value },
      })
    },
    async buildStart() {
      if (command !== 'build') {
        return
      }
      await refreshRoutes()
      const shouldInject = buildSwLifecycleScript({
        importPath: 'mokup/sw',
        swConfig,
        unregisterConfig,
        hasSwEntries,
        hasSwRoutes: hasSwRoutes(),
        resolveRequestPath: resolveSwRequestPath,
        resolveRegisterScope: resolveSwRegisterScope,
      }) !== null
      swLifecycleScript = null
      if (shouldInject) {
        swLifecycleFileName = resolveAssetsFileName('mokup-sw-lifecycle.js')
        this.emitFile({
          type: 'chunk',
          id: swLifecycleVirtualId,
          fileName: swLifecycleFileName,
        })
      }
      else {
        swLifecycleFileName = null
      }
      if (!swConfig || !hasSwRoutes()) {
        return
      }
      this.emitFile({
        type: 'chunk',
        id: swVirtualId,
        fileName: resolveSwOutputFileName(base, swConfig.path),
      })
    },
    async transformIndexHtml(html) {
      return transformMokupIndexHtml(html, {
        state,
        refreshRoutes,
        currentServer,
        command,
        base,
        swConfig,
        unregisterConfig,
        hasSwEntries,
        resolveSwImportPath,
        resolveRequestPath: resolveSwRequestPath,
        resolveRegisterScope: resolveSwRegisterScope,
        swLifecycleFileName,
        swLifecycleImportPath: resolveRegisterPath(base, `/@id/${resolvedSwLifecycleVirtualId.replace('\0', '__x00__')}`),
        resolveHtmlAssetPath,
      })
    },
    configResolved(config) {
      root = config.root
      base = config.base ?? '/'
      command = config.command
      assetsDir = config.build.assetsDir ?? 'assets'
      outDir = resolve(config.root, config.build.outDir ?? 'dist')
      isSsrBuild = !!config.build.ssr
    },
    async configureServer(server) {
      const session = sessions.start(server)
      const watcher = await configureDevServer({
        server,
        state,
        root,
        base,
        logger,
        playgroundConfig,
        playgroundMiddleware,
        swConfig,
        enableViteMiddleware,
        refreshRoutes: (_server, refreshOptions) => session.refresh(refreshOptions),
        resolveAllDirs,
        watchEnabled,
      })
      session.attachWatcher(watcher)
    },
    async configurePreviewServer(server) {
      const session = sessions.start(server)
      const watcher = await configurePreviewServer({
        server,
        state,
        root,
        base,
        logger,
        playgroundConfig,
        playgroundMiddleware,
        swConfig,
        enableViteMiddleware,
        refreshRoutes: (_server, refreshOptions) => session.refresh(refreshOptions),
        resolveAllDirs,
        watchEnabled,
      })
      session.attachWatcher(watcher)
    },
    async closeBundle() {
      if (command !== 'build' || isSsrBuild || !playgroundConfig.enabled || playgroundConfig.build !== true) {
        return
      }
      await refreshRoutes()
      const swScript = buildSwLifecycleInlineScript({
        swConfig,
        unregisterConfig,
        hasSwEntries,
        hasSwRoutes: hasSwRoutes(),
        resolveRequestPath: resolveSwRequestPath,
        resolveRegisterScope: resolveSwRegisterScope,
      })
      await writePlaygroundBuild({
        outDir,
        base,
        playgroundPath: playgroundConfig.path,
        root,
        routes: state.routes,
        disabledRoutes: state.disabledRoutes,
        ignoredRoutes: state.ignoredRoutes,
        configFiles: state.configFiles,
        disabledConfigFiles: state.disabledConfigFiles,
        dirs: resolveAllDirs(),
        swScript,
        logger,
        resolvePlaygroundDist,
      })
    },
  }
}
