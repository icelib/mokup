import type { PreviewServer, ViteDevServer } from 'vite'
import type { MokupPluginOptions } from '../shared/types'

import type {
  WebpackPluginInstance,
} from './plugin/types'
import { cwd } from 'node:process'
import {
  collectSwConflictDiagnosticWarning,
  createSwConflictDiagnosticSections,
  reportDiagnostics,
} from '@mokup/shared/diagnostics'
import { createMiddleware, createPlaygroundMiddleware, resolvePlaygroundOptions, resolveSwConfig, resolveSwUnregisterConfig } from '../internal/core'
import { resolvePlaygroundDist } from '../playground/assets'
import { createLogger } from '../shared/logger'
import { createCompilationHandler } from './plugin/compilation'
import { createWebpackController } from './plugin/controller'
import { normalizeMokupOptions, normalizeOptions } from './plugin/options'
import {
  resolveAssetsDir,
  resolveBaseFromPublicPath,
} from './plugin/paths'
import { createSwMiddleware } from './plugin/sw-middleware'

const pluginName = 'mokup:webpack'
const lifecycleBaseName = 'mokup-sw-lifecycle.js'

export function createMokupWebpackPlugin(
  options: MokupPluginOptions = {},
): WebpackPluginInstance {
  const normalizedOptions = normalizeMokupOptions(options)
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
  return {
    apply(compiler) {
      const root = compiler.context ?? cwd()
      const assetsDir = resolveAssetsDir(compiler.options.output?.assetModuleFilename)
      const getBase = () => resolveBaseFromPublicPath(
        compiler.options.devServer?.devMiddleware?.publicPath ?? compiler.options.output?.publicPath,
      )
      const controller = createWebpackController({
        compiler,
        optionList,
        root,
        getBase,
        swConfig,
        unregisterConfig,
        watchEnabled,
        logger,
        ...(normalizedOptions.errorOn ? { errorOn: normalizedOptions.errorOn } : {}),
      })
      const playgroundMiddleware = createPlaygroundMiddleware({
        getRoutes: () => controller.getSnapshot()?.state.routes ?? [],
        getDisabledRoutes: () => controller.getSnapshot()?.state.disabledRoutes ?? [],
        getIgnoredRoutes: () => controller.getSnapshot()?.state.ignoredRoutes ?? [],
        getConfigFiles: () => controller.getSnapshot()?.state.configFiles ?? [],
        getDisabledConfigFiles: () => controller.getSnapshot()?.state.disabledConfigFiles ?? [],
        config: playgroundConfig,
        logger,
        getDirs: controller.getDirs,
        getServer: () => ({ config: { base: getBase(), root } } as ViteDevServer | PreviewServer),
        resolvePlaygroundDist,
      })
      const swMiddleware = createSwMiddleware({ swConfig, getSession: controller.getSession, getBase })
      const mockMiddleware = createMiddleware(() => controller.getSnapshot()?.state.app ?? null, logger)

      compiler.hooks.beforeCompile.tapPromise(pluginName, async () => {
        await controller.ensureBuilt()
      })
      compiler.hooks.thisCompilation.tap(pluginName, createCompilationHandler({
        compiler,
        getSession: controller.getSession,
        lifecycleFileName: `${assetsDir}/${lifecycleBaseName}`,
        swPath: swConfig?.path,
        logger,
      }))

      const devServer = compiler.options.devServer
      if (devServer) {
        const originalSetup = devServer.setupMiddlewares
        devServer.setupMiddlewares = (middlewares, server) => {
          controller.setup()
          const resolved = originalSetup ? originalSetup(middlewares, server) ?? middlewares : middlewares
          resolved.unshift(
            { name: 'mokup-playground', middleware: playgroundMiddleware },
            { name: 'mokup-sw', middleware: swMiddleware },
            { name: 'mokup-mock', middleware: mockMiddleware },
          )
          return resolved
        }
      }
    },
  }
}
