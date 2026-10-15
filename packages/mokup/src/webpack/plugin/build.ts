import type { resolveSwConfig, resolveSwUnregisterConfig } from '../../internal/core'
import type { DiagnosticErrorMode, Logger, VitePluginOptions } from '../../shared/types'
import type { BundleState } from './bundles'
import type { PluginState } from './state'
import { createBundleBuilder } from './bundles'
import { resolveModuleFilePath, resolveRegisterPath, resolveRegisterScope } from './paths'
import { createRouteRefresher } from './refresh'

interface WebpackBuildSnapshot {
  state: PluginState
  bundles: BundleState
  root: string
  base: string
}

function createWebpackBuild(options: {
  optionList: VitePluginOptions[]
  root: () => string
  base: () => string
  swConfig: ReturnType<typeof resolveSwConfig>
  unregisterConfig: ReturnType<typeof resolveSwUnregisterConfig>
  logger: Logger
  errorOn?: DiagnosticErrorMode
}) {
  let diagnosticsSignature: string | null = null

  return async (isActive: () => boolean): Promise<WebpackBuildSnapshot | null> => {
    if (!isActive()) {
      return null
    }
    const root = options.root()
    const base = options.base()
    const state: PluginState = {
      routes: [],
      serverRoutes: [],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: null,
      lastDiagnosticsSignature: diagnosticsSignature,
    }
    const bundles: BundleState = { swLifecycleBundle: null, swBundle: null }
    const guardLog = (method: keyof Logger) => (...args: unknown[]) => {
      if (isActive()) {
        options.logger[method]?.(...args)
      }
    }
    const logger: Logger = {
      info: guardLog('info'),
      warn: guardLog('warn'),
      error: guardLog('error'),
      log: guardLog('log'),
    }
    const refreshRoutes = createRouteRefresher({
      state,
      optionList: options.optionList,
      root: () => root,
      logger,
      ...(options.errorOn ? { errorOn: options.errorOn } : {}),
    })
    try {
      await refreshRoutes()
    }
    finally {
      if (isActive()) {
        diagnosticsSignature = state.lastDiagnosticsSignature
      }
    }
    if (!isActive()) {
      return null
    }
    const { rebuildBundles } = createBundleBuilder({
      state,
      bundleState: bundles,
      root: () => root,
      swConfig: options.swConfig,
      unregisterConfig: options.unregisterConfig,
      hasSwEntries: options.optionList.some(entry => entry.mode === 'sw'),
      hasSwRoutes: () => isActive() && !!options.swConfig && state.swRoutes.length > 0,
      resolveRequestPath: path => resolveRegisterPath(base, path),
      resolveRegisterScope: scope => resolveRegisterScope(base, scope),
      resolveModulePath: resolveModuleFilePath,
      refreshRoutes,
      logger,
    })
    await rebuildBundles()
    return isActive() ? { state, bundles, root, base } : null
  }
}

export type { WebpackBuildSnapshot }
export { createWebpackBuild }
