import type { PreviewServer, ViteDevServer } from 'vite'
import type { RouteConfigInfo, RouteIgnoreInfo, RouteSkipInfo } from '../../internal/core'
import type { DiagnosticErrorMode, RouteTable, VitePluginOptions } from '../../shared/types'
import type { PluginState } from './state'
import { collectRouteDiagnosticWarning, createRouteDiagnosticSections, reportDiagnostics } from '@mokup/shared/diagnostics'
import { relative } from '@mokup/shared/pathe'
import { createHonoApp, scanRoutes, sortRoutes } from '../../internal/core'
import { resolveDirs, toPosix } from '../../shared/utils'
import { buildRouteSignature } from './routes'
import { isViteDevServer } from './server'

interface InvalidatableModuleNode {
  importers?: Set<InvalidatableModuleNode>
}

interface ModuleGraphLike {
  getModuleById: (id: string) => InvalidatableModuleNode | null | undefined
  invalidateModule: (node: InvalidatableModuleNode) => void
}

interface ViteServerWithEnvironments {
  // Vite 8 exposes one module graph per environment. Keep this optional so
  // the plugin remains compatible with Vite 5-7, which only expose the mixed
  // server graph.
  environments?: Record<string, { moduleGraph?: ModuleGraphLike }>
}

function invalidateModuleChain(moduleGraph: ModuleGraphLike, node: InvalidatableModuleNode) {
  const visited = new Set<InvalidatableModuleNode>()
  const stack = [node]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || visited.has(current)) {
      continue
    }
    visited.add(current)
    moduleGraph.invalidateModule(current)
    if (current.importers) {
      for (const importer of current.importers) {
        stack.push(importer)
      }
    }
  }
}

function getModuleGraphs(server: ViteDevServer): ModuleGraphLike[] {
  const graphs: ModuleGraphLike[] = [server.moduleGraph as unknown as ModuleGraphLike]
  const environments = (server as unknown as ViteServerWithEnvironments).environments
  if (environments) {
    for (const environment of Object.values(environments)) {
      if (environment.moduleGraph) {
        graphs.push(environment.moduleGraph)
      }
    }
  }
  return Array.from(new Set(graphs))
}

function invalidateVirtualModuleChains(server: ViteDevServer, moduleIds: string[]) {
  for (const moduleGraph of getModuleGraphs(server)) {
    for (const id of moduleIds) {
      const moduleNode = moduleGraph.getModuleById(id)
      if (moduleNode) {
        invalidateModuleChain(moduleGraph, moduleNode)
      }
    }
  }
}

function createRouteRefresher(params: {
  state: PluginState
  optionList: VitePluginOptions[]
  root: () => string
  logger: Parameters<typeof scanRoutes>[0]['logger']
  enableViteMiddleware: boolean
  virtualModuleIds?: string[]
  reloadOnChange?: boolean
  reloadOnFirstSwRoute?: boolean
  errorOn?: DiagnosticErrorMode
}) {
  const {
    state,
    optionList,
    root,
    logger,
    enableViteMiddleware,
    virtualModuleIds,
    reloadOnChange = false,
    reloadOnFirstSwRoute = false,
    errorOn,
  } = params

  return async (
    server?: ViteDevServer | PreviewServer,
    options?: { force?: boolean, silent?: boolean },
  ) => {
    const hadSwRoutes = state.swRoutes.length > 0
    const unsupportedRuleFiles = new Set<string>()
    const missingHandlerFiles = new Set<string>()
    const duplicateRoutes = new Set<string>()
    const diagnosticLogger = {
      ...logger,
      warn: (...args: unknown[]) => {
        if (args.length > 0) {
          collectRouteDiagnosticWarning({
            message: args.map(String).join(' '),
            onUnsupportedFields: value => unsupportedRuleFiles.add(toPosix(relative(root(), value))),
            onMissingHandler: value => missingHandlerFiles.add(toPosix(relative(root(), value))),
            onDuplicateRoute: value => duplicateRoutes.add(value),
          })
        }
        logger.warn(...args)
      },
    }
    const collected: RouteTable = []
    const collectedServer: RouteTable = []
    const collectedSw: RouteTable = []
    const collectedDisabled: RouteSkipInfo[] = []
    const collectedIgnored: RouteIgnoreInfo[] = []
    const collectedConfigs: RouteConfigInfo[] = []
    for (const entry of optionList) {
      const dirs = resolveDirs(entry.dir, root())
      const scanParams: Parameters<typeof scanRoutes>[0] = {
        dirs,
        prefix: entry.prefix ?? '',
        logger: diagnosticLogger,
        onSkip: info => collectedDisabled.push(info),
        onIgnore: info => collectedIgnored.push(info),
        onConfig: info => collectedConfigs.push(info),
      }
      if (entry.include) {
        scanParams.include = entry.include
      }
      if (entry.exclude) {
        scanParams.exclude = entry.exclude
      }
      if (typeof entry.ignorePrefix !== 'undefined') {
        scanParams.ignorePrefix = entry.ignorePrefix
      }
      if (server) {
        scanParams.server = server
      }
      const scanned = await scanRoutes(scanParams)
      collected.push(...scanned)
      if (entry.mode === 'sw') {
        collectedSw.push(...scanned)
        if (entry.sw?.fallback !== false) {
          collectedServer.push(...scanned)
        }
      }
      else {
        collectedServer.push(...scanned)
      }
    }
    const routes = sortRoutes(collected)
    const serverRoutes = sortRoutes(collectedServer)
    const swRoutes = sortRoutes(collectedSw)
    const configMap = new Map(collectedConfigs.map(entry => [entry.file, entry]))
    const resolvedConfigs = Array.from(configMap.values())
    const configFiles = resolvedConfigs.filter(entry => entry.enabled)
    const disabledConfigFiles = resolvedConfigs.filter(entry => !entry.enabled)
    const diagnosticSections = createRouteDiagnosticSections({
      invalidRoutes: collectedIgnored
        .filter(info => info.reason === 'invalid-route')
        .map(info => toPosix(relative(root(), info.file))),
      unsupportedFields: Array.from(unsupportedRuleFiles),
      missingHandlers: Array.from(missingHandlerFiles),
      duplicateRoutes: Array.from(duplicateRoutes),
    })
    const { error: diagnosticError, summaryLines: diagnosticLines } = reportDiagnostics({
      ...(errorOn ? { errorOn } : {}),
      sections: diagnosticSections,
    })
    const diagnosticSignature = diagnosticLines.join('\n')
    const previousDiagnosticsSignature = state.lastDiagnosticsSignature ?? ''
    const diagnosticsChanged = diagnosticSignature !== previousDiagnosticsSignature
    // Diagnostics describe the latest scan, even when its route snapshot is rejected.
    state.lastDiagnosticsSignature = diagnosticLines.length > 0 ? diagnosticSignature : null
    if (diagnosticError) {
      throw diagnosticError
    }
    if (!options?.silent && diagnosticsChanged) {
      if (diagnosticLines.length > 0) {
        for (const line of diagnosticLines) {
          logger.warn(line)
        }
      }
      else if (previousDiagnosticsSignature) {
        logger.info('Mokup diagnostics cleared.')
      }
    }
    const app = enableViteMiddleware && serverRoutes.length > 0
      ? createHonoApp(serverRoutes)
      : null
    const signature = buildRouteSignature(
      routes,
      collectedDisabled,
      collectedIgnored,
      configFiles,
      disabledConfigFiles,
    )
    const previousSignature = state.lastSignature
    const changed = signature !== previousSignature || options?.force
    // Prepare every field before publishing, and notify only after the complete
    // snapshot is visible to middleware, virtual modules, and Playground readers.
    const snapshot = {
      routes,
      serverRoutes,
      swRoutes,
      disabledRoutes: collectedDisabled,
      ignoredRoutes: collectedIgnored,
      configFiles,
      disabledConfigFiles,
      app,
      lastSignature: signature,
      ...(changed && swRoutes.length > 0 ? { swModuleVersion: (state.swModuleVersion ?? 0) + 1 } : {}),
    } satisfies Omit<PluginState, 'lastDiagnosticsSignature'>
    Object.assign(state, snapshot)
    if (isViteDevServer(server) && server.ws) {
      const shouldNotify = !options?.silent
        && previousSignature !== null
        && changed
      if (shouldNotify) {
        server.ws.send({
          type: 'custom',
          event: 'mokup:routes-changed',
          data: { ts: Date.now() },
        })
        if (virtualModuleIds && virtualModuleIds.length > 0) {
          invalidateVirtualModuleChains(server, virtualModuleIds)
        }
        // An initially empty page has no SW registration script yet. Let Vite's
        // existing client load the HTML that registers the first worker.
        if (reloadOnChange || (reloadOnFirstSwRoute && !hadSwRoutes && state.swRoutes.length > 0)) {
          server.ws.send({ type: 'full-reload', path: '*' })
        }
      }
    }
  }
}

export { createRouteRefresher }
