import type { WebSocketServerLike } from '@hono/node-server'
import type { Hono } from '@mokup/shared/hono'
import type { RouteConfigInfo, RouteIgnoreInfo, RouteSkipInfo } from './dev/scanner'
import type { RouteTable } from './dev/types'

import type {
  FetchServerOptionsInput,
} from './fetch-options'
import { collectRouteDiagnosticWarning, createRouteDiagnosticSections, reportDiagnostics } from '@mokup/shared/diagnostics'
import { relative } from '@mokup/shared/pathe'
import { createLogger } from './dev/logger'
import { resolvePlaygroundOptions } from './dev/playground'
import { sortRoutes } from './dev/routes'
import { scanRoutes } from './dev/scanner'
import { resolveDirs } from './dev/utils'
import { buildFetchServerApp } from './fetch-server/app'
import { normalizeOptions, resolveAllDirs, resolveRoot } from './fetch-server/options'
import { createPlaygroundWs } from './fetch-server/playground-ws'
import { createRefreshController } from './fetch-server/refresh-controller'
import { createWatcher } from './fetch-server/watcher'

const diagnosticErrorTitle = 'Mokup diagnostics error:'

export type {
  FetchServerOptions,
  FetchServerOptionsConfig,
  FetchServerOptionsInput,
} from './fetch-options'

/**
 * Fetch server instance returned by createFetchServer.
 *
 * @example
 * import type { FetchServer } from '@mokup/server'
 *
 * const server: FetchServer = {
 *   fetch: async () => new Response('ok'),
 *   refresh: async () => {},
 *   getRoutes: () => [],
 * }
 */
export interface FetchServer {
  /** Fetch handler for runtime requests. */
  fetch: (
    request: Request,
    env?: Parameters<Hono['fetch']>[1],
    executionCtx?: Parameters<Hono['fetch']>[2],
  ) => Promise<Response>
  /** Refresh the route table. */
  refresh: () => Promise<void>
  /** Read the current route table. */
  getRoutes: () => RouteTable
  /** WebSocket configuration for the Hono Node server adapter. */
  websocket?: { server: WebSocketServerLike }
  /** Stop watching and drain pending refresh work; explicit refresh remains available. */
  close?: () => Promise<void>
}

/**
 * Create a fetch server that scans routes and serves playground metadata.
 *
 * @param options - Server options input.
 * @returns Fetch server instance.
 *
 * @example
 * import { createFetchServer } from '@mokup/server'
 *
 * const server = await createFetchServer({ entries: { dir: 'mock' } })
 */
export async function createFetchServer(
  options: FetchServerOptionsInput = {},
): Promise<FetchServer> {
  const normalized = normalizeOptions(options)
  const optionList = normalized.entries
  const root = resolveRoot(optionList)
  const logEnabled = optionList.every(entry => entry.log !== false)
  const watchEnabled = optionList.every(entry => entry.watch !== false)
  const logger = createLogger(logEnabled)
  const playgroundConfig = resolvePlaygroundOptions(normalized.playground)
  const dirs = resolveAllDirs(optionList, root)

  const playgroundWs = createPlaygroundWs(playgroundConfig)
  await playgroundWs.setupPlaygroundWebSocket()

  let routes: RouteTable = []
  const appParams: Parameters<typeof buildFetchServerApp>[0] = {
    routes,
    disabledRoutes: [],
    ignoredRoutes: [],
    configFiles: [],
    disabledConfigFiles: [],
    dirs,
    playground: playgroundConfig,
    root,
    logger,
    onResponse: playgroundWs.handleRouteResponse,
  }
  const initialWsHandler = playgroundWs.getWsHandler()
  if (initialWsHandler) {
    appParams.wsHandler = initialWsHandler
  }
  let app = buildFetchServerApp(appParams)

  const refreshRoutes = async (refreshOptions?: { throwOnError?: boolean }) => {
    try {
      const collected: RouteTable = []
      const collectedDisabled: RouteSkipInfo[] = []
      const collectedIgnored: RouteIgnoreInfo[] = []
      const collectedConfigs: RouteConfigInfo[] = []
      const unsupportedRuleFiles = new Set<string>()
      const missingHandlerFiles = new Set<string>()
      const duplicateRoutes = new Set<string>()
      for (const entry of optionList) {
        const diagnosticLogger = {
          ...logger,
          warn: (...args: unknown[]) => {
            if (args.length > 0) {
              collectRouteDiagnosticWarning({
                message: args.map(String).join(' '),
                onUnsupportedFields: value => unsupportedRuleFiles.add(value),
                onMissingHandler: value => missingHandlerFiles.add(value),
                onDuplicateRoute: value => duplicateRoutes.add(value),
              })
            }
            logger.warn(...args)
          },
        }
        const scanParams: Parameters<typeof scanRoutes>[0] = {
          dirs: resolveDirs(entry.dir, root),
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
        const scanned = await scanRoutes(scanParams)
        collected.push(...scanned)
      }
      const errorOn = optionList.find(entry => typeof entry.errorOn !== 'undefined')?.errorOn
      const diagnosticSections = createRouteDiagnosticSections({
        invalidRoutes: collectedIgnored
          .filter(info => info.reason === 'invalid-route')
          .map(info => relative(root, info.file)),
        unsupportedFields: Array.from(unsupportedRuleFiles).map(file => relative(root, file)),
        missingHandlers: Array.from(missingHandlerFiles).map(file => relative(root, file)),
        duplicateRoutes: Array.from(duplicateRoutes),
      })
      const diagnosticParams: Parameters<typeof reportDiagnostics>[0] = {
        errorTitle: diagnosticErrorTitle.slice(0, -1),
        sections: diagnosticSections,
        warn: message => logger.warn(message),
      }
      if (typeof errorOn !== 'undefined') {
        diagnosticParams.errorOn = errorOn
      }
      const { error: diagnosticError } = reportDiagnostics(diagnosticParams)
      if (diagnosticError) {
        throw diagnosticError
      }
      const resolvedRoutes = sortRoutes(collected)
      const configMap = new Map(collectedConfigs.map(entry => [entry.file, entry]))
      const resolvedConfigs = Array.from(configMap.values())
      const refreshedParams: Parameters<typeof buildFetchServerApp>[0] = {
        routes: resolvedRoutes,
        disabledRoutes: collectedDisabled,
        ignoredRoutes: collectedIgnored,
        configFiles: resolvedConfigs.filter(entry => entry.enabled),
        disabledConfigFiles: resolvedConfigs.filter(entry => !entry.enabled),
        dirs,
        playground: playgroundConfig,
        root,
        logger,
        onResponse: playgroundWs.handleRouteResponse,
      }
      const refreshedWsHandler = playgroundWs.getWsHandler()
      if (refreshedWsHandler) {
        refreshedParams.wsHandler = refreshedWsHandler
      }
      const refreshedApp = buildFetchServerApp(refreshedParams)
      routes = resolvedRoutes
      app = refreshedApp
      logger.info(`Loaded ${routes.length} mock routes.`)
    }
    catch (error) {
      logger.error('Failed to scan mock routes:', error)
      if (
        refreshOptions?.throwOnError
        && error instanceof Error
        && error.message.startsWith(diagnosticErrorTitle)
      ) {
        throw error
      }
    }
  }

  const refreshController = createRefreshController(
    refreshRoutes,
    error => logger.error('Failed to refresh mock routes:', error),
  )
  await refreshController.refresh()
  const watcher = await createWatcher({
    enabled: watchEnabled,
    dirs,
    onChange: refreshController.schedule,
    logger,
  })

  const fetch: FetchServer['fetch'] = async (request, env, executionCtx) => {
    return await app.fetch(request, env, executionCtx)
  }

  const server: FetchServer = {
    fetch,
    refresh: refreshController.refresh,
    getRoutes: () => routes,
  }
  const websocket = playgroundWs.getWebSocketOptions()
  if (websocket) {
    server.websocket = websocket
  }

  if (watcher) {
    let closePromise: Promise<void> | undefined
    server.close = () => {
      if (!closePromise) {
        const drain = refreshController.stopWatching()
        closePromise = Promise.resolve().then(async () => {
          try {
            await watcher.close()
          }
          finally {
            await drain
          }
        })
      }
      return closePromise
    }
  }

  return server
}
