import type { PreviewServer, ViteDevServer } from 'vite'
import type { PlaygroundConfig, resolveSwConfig } from '../../internal/core'
import type { Logger } from '../../shared/types'
import type { MiddlewareHandler } from './middleware'
import type { PluginState } from './state'
import { buildSwScript, createMiddleware } from '../../internal/core'
import { parseHttpRequestUrl } from '../../shared/http-request'
import { addMiddlewareFirst } from './middleware'
import {
  resolveRegisterPath,
  resolveSwLoggerImportPath,
  resolveSwRuntimeImportPath,
} from './paths'
import { patchPlaygroundPrintUrls } from './playground'
import { createStaticPlaygroundPreviewMiddleware } from './preview-playground'
import { setupPreviewWatchers, setupViteWatchers } from './watcher'

async function configureDevServer(params: {
  server: ViteDevServer
  state: PluginState
  root: string
  base: string
  logger: Logger
  playgroundConfig: PlaygroundConfig
  playgroundMiddleware: MiddlewareHandler
  swConfig: ReturnType<typeof resolveSwConfig>
  enableViteMiddleware: boolean
  refreshRoutes: (
    server?: ViteDevServer | PreviewServer,
    options?: { force?: boolean, silent?: boolean },
  ) => Promise<void>
  resolveAllDirs: () => string[]
  watchEnabled: boolean
}) {
  const {
    server,
    state,
    root,
    base,
    logger,
    playgroundConfig,
    playgroundMiddleware,
    swConfig,
    enableViteMiddleware,
    refreshRoutes,
    resolveAllDirs,
    watchEnabled,
  } = params

  await refreshRoutes(server)
  if (enableViteMiddleware) {
    addMiddlewareFirst(server, createMiddleware(() => state.app, logger))
  }
  addMiddlewareFirst(server, playgroundMiddleware)
  if (playgroundConfig.enabled) {
    const playgroundPath = resolveRegisterPath(base, playgroundConfig.path)
    patchPlaygroundPrintUrls(server, playgroundPath)
  }
  const swPath = swConfig ? resolveRegisterPath(base, swConfig.path) : null
  if (swPath) {
    server.middlewares.use(async (req, res, next) => {
      const parsed = parseHttpRequestUrl(req, res)
      if (!parsed) {
        return
      }
      if (parsed.pathname !== swPath) {
        return next()
      }
      try {
        const code = buildSwScript({
          routes: state.swRoutes,
          root,
          runtimeImportPath: resolveSwRuntimeImportPath(base),
          loggerImportPath: resolveSwLoggerImportPath(base),
          basePaths: swConfig?.basePaths ?? [],
          ...(typeof state.swModuleVersion !== 'undefined'
            ? { moduleVersion: state.swModuleVersion }
            : {}),
        })
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(code)
      }
      catch (error) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end('Failed to generate mokup service worker.')
        logger.error('SW generation failed:', error)
      }
    })
  }
  if (!watchEnabled) {
    return
  }
  const dirs = resolveAllDirs()
  return setupViteWatchers({
    server,
    root,
    dirs,
    refresh: options => refreshRoutes(server, options),
    onError: error => logger.error('Mock route refresh failed:', error),
  })
}

async function configurePreviewServer(params: {
  server: PreviewServer
  state: PluginState
  root: string
  base: string
  logger: Logger
  playgroundConfig: PlaygroundConfig
  playgroundMiddleware: MiddlewareHandler
  swConfig: ReturnType<typeof resolveSwConfig>
  enableViteMiddleware: boolean
  refreshRoutes: (
    server?: ViteDevServer | PreviewServer,
    options?: { force?: boolean, silent?: boolean },
  ) => Promise<void>
  resolveAllDirs: () => string[]
  watchEnabled: boolean
}) {
  const {
    server,
    state,
    root,
    base,
    logger,
    playgroundConfig,
    playgroundMiddleware,
    enableViteMiddleware,
    refreshRoutes,
    resolveAllDirs,
    watchEnabled,
  } = params

  await refreshRoutes(server)
  const mockMiddleware = enableViteMiddleware ? createMiddleware(() => state.app, logger) : null
  if (playgroundConfig.enabled && playgroundConfig.build) {
    addMiddlewareFirst(server, createStaticPlaygroundPreviewMiddleware({
      base,
      playgroundPath: playgroundConfig.path,
      mockMiddleware,
    }))
  }
  else {
    if (mockMiddleware) {
      addMiddlewareFirst(server, mockMiddleware)
    }
    addMiddlewareFirst(server, playgroundMiddleware)
  }
  // Vite serves the bundled SW from its output directory. Raw source needs the dev transformer.
  if (!watchEnabled) {
    return null
  }
  const dirs = resolveAllDirs()
  const watcher = setupPreviewWatchers({
    server,
    root,
    dirs,
    refresh: options => refreshRoutes(server, options),
    onError: error => logger.error('Mock route refresh failed:', error),
  })
  return watcher
}

export { configureDevServer, configurePreviewServer }
