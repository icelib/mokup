import type { HttpHandler, MockSession, UnhandledRequestPolicy } from '@mokup/runtime/http'
import type { resolveSwConfig, resolveSwUnregisterConfig } from '../../internal/core'
import type { DiagnosticErrorMode, Logger, VitePluginOptions } from '../../shared/types'
import type { WebpackBuildSession, WebpackBuildSnapshot } from './session'
import type { WebpackCompiler } from './types'
import { createMockSession } from '@mokup/runtime/http'
import { createHonoApp } from '../../internal/core'
import { resolveDirs } from '../../shared/utils'
import { createWebpackBuild } from './build'
import { createWebpackBuildSession } from './session'
import { createWebpackWatcher } from './watcher'

interface ActiveSession {
  build: WebpackBuildSession
  http: MockSession
  watching: WebpackCompiler['watching']
  watcher: ReturnType<typeof createWebpackWatcher>
  startingWatcher: boolean
}

export function createWebpackController(params: {
  compiler: WebpackCompiler
  optionList: VitePluginOptions[]
  root: string
  getBase: () => string
  swConfig: ReturnType<typeof resolveSwConfig>
  unregisterConfig: ReturnType<typeof resolveSwUnregisterConfig>
  watchEnabled: boolean
  logger: Logger
  errorOn?: DiagnosticErrorMode
  handlers?: readonly HttpHandler[]
  onUnhandled?: UnhandledRequestPolicy
}) {
  const { compiler, logger } = params
  let current: ActiveSession | null = null
  let previousSnapshot: WebpackBuildSnapshot | null = null
  let pausedHttp: MockSession | undefined
  let drain = Promise.resolve()
  let stopped = false
  let middlewaresReady = false

  const getDirs = () => Array.from(new Set(params.optionList.flatMap(entry => resolveDirs(entry.dir, params.root))))
  const isCurrent = (session: ActiveSession) => current === session && session.build.isActive()

  function startWatcher(session: ActiveSession) {
    if (!middlewaresReady || !params.watchEnabled || !session.watching || session.watcher || session.startingWatcher) {
      return
    }
    session.startingWatcher = true
    void drain.then(() => {
      if (!isCurrent(session)) {
        return
      }
      session.watcher = createWebpackWatcher({
        enabled: params.watchEnabled,
        dirs: getDirs(),
        onRefresh: async () => { await session.build.refresh() },
        onError: error => logger.error('Failed to refresh mokup routes:', error),
      })
    }).catch((error) => {
      logger.error('Failed to start mokup watcher:', error)
    }).finally(() => {
      session.startingWatcher = false
    })
  }

  function close(retainSnapshot = false) {
    stopped = true
    const closing = current
    if (!closing && !pausedHttp) {
      return drain
    }
    current = null
    const snapshot = closing?.build.peek() ?? previousSnapshot
    const tasks = [drain]
    if (pausedHttp) {
      tasks.push(pausedHttp.dispose())
      pausedHttp = undefined
    }
    if (closing) {
      tasks.push(closing.build.close(), closing.http.dispose())
      if (closing.watcher) {
        tasks.push(closing.watcher.close())
      }
    }
    previousSnapshot = null
    if (retainSnapshot && snapshot) {
      // A paused compiler keeps its last file baseline available to an HTTP
      // server. It owns fresh state; overrides and live streams close above.
      const app = createHonoApp(snapshot.state.serverRoutes)
      pausedHttp = app.mockSession
      previousSnapshot = { ...snapshot, state: { ...snapshot.state, app } }
    }
    drain = Promise.allSettled(tasks).then((results) => {
      const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Failed to close mokup Webpack session.')
      }
    })
    // watchClose is synchronous; retain the rejection for shutdown as well.
    void drain.catch(error => logger.error('Failed to close mokup watcher:', error))
    return drain
  }

  function activate(watching: WebpackCompiler['watching']) {
    stopped = false
    const http = createMockSession({
      ...(params.handlers ? { handlers: params.handlers } : {}),
      ...(params.onUnhandled ? { onUnhandled: params.onUnhandled } : {}),
    })
    if (previousSnapshot) {
      const app = createHonoApp(previousSnapshot.state.serverRoutes, {
        session: http,
        ...(params.handlers ? { handlers: params.handlers } : {}),
      })
      previousSnapshot = { ...previousSnapshot, state: { ...previousSnapshot.state, app } }
    }
    if (pausedHttp) {
      const disposal = pausedHttp.dispose()
      pausedHttp = undefined
      drain = Promise.all([drain, disposal]).then(() => {})
      void drain.catch(error => logger.error('Failed to close paused mokup session:', error))
    }
    const build = createWebpackBuild({
      optionList: params.optionList,
      root: () => params.root,
      base: params.getBase,
      swConfig: params.swConfig,
      unregisterConfig: params.unregisterConfig,
      logger,
      session: http,
      ...(params.handlers ? { handlers: params.handlers } : {}),
      ...(params.errorOn ? { errorOn: params.errorOn } : {}),
    })
    const session: ActiveSession = {
      http,
      watching,
      watcher: null,
      startingWatcher: false,
      build: createWebpackBuildSession({
        build,
        previous: drain,
        onRefresh: () => {
          if (isCurrent(session) && session.watching === compiler.watching) {
            session.watching?.invalidate()
          }
        },
        onError: error => logger.error('Failed to build mokup bundles:', error),
      }),
    }
    current = session
    startWatcher(session)
    return session
  }

  compiler.hooks.watchRun.tap('mokup:webpack', (active) => {
    if (current && !current.watching) {
      current.watching = active.watching
    }
    else if (current && current.watching !== active.watching) {
      void close(true)
    }
    const session = current ?? activate(active.watching)
    startWatcher(session)
  })
  compiler.hooks.beforeRun?.tap('mokup:webpack', () => {
    if (current?.watching) {
      void close(true)
    }
    if (!current) {
      activate(undefined)
    }
  })
  compiler.hooks.watchClose.tap('mokup:webpack', () => {
    void close(true)
  })
  compiler.hooks.shutdown?.tapPromise('mokup:webpack', () => close())

  async function ensureBuilt() {
    const session = current ?? (stopped ? null : activate(compiler.watching))
    return session?.build.ensureBuilt() ?? null
  }

  return {
    ensureBuilt,
    getSession: () => current?.build ?? null,
    getMockSession: () => current?.http,
    getRequestSession: () => current?.http ?? pausedHttp,
    getSnapshot: () => current?.build.peek() ?? previousSnapshot,
    getDirs,
    setup() {
      middlewaresReady = true
      if (stopped) {
        return
      }
      const session = current ?? activate(compiler.watching)
      startWatcher(session)
      void session.build.ensureBuilt()
    },
  }
}
