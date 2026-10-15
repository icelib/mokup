import type { resolveSwConfig, resolveSwUnregisterConfig } from '../../internal/core'
import type { DiagnosticErrorMode, Logger, VitePluginOptions } from '../../shared/types'
import type { WebpackBuildSession, WebpackBuildSnapshot } from './session'
import type { WebpackCompiler } from './types'
import { resolveDirs } from '../../shared/utils'
import { createWebpackBuild } from './build'
import { createWebpackBuildSession } from './session'
import { createWebpackWatcher } from './watcher'

interface ActiveSession {
  build: WebpackBuildSession
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
}) {
  const { compiler, logger } = params
  let current: ActiveSession | null = null
  let previousSnapshot: WebpackBuildSnapshot | null = null
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

  function close() {
    stopped = true
    const closing = current
    if (!closing) {
      return drain
    }
    current = null
    previousSnapshot = closing.build.peek() ?? previousSnapshot
    const tasks = [closing.build.close()]
    if (closing.watcher) {
      tasks.push(closing.watcher.close())
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
    const build = createWebpackBuild({
      optionList: params.optionList,
      root: () => params.root,
      base: params.getBase,
      swConfig: params.swConfig,
      unregisterConfig: params.unregisterConfig,
      logger,
      ...(params.errorOn ? { errorOn: params.errorOn } : {}),
    })
    const session: ActiveSession = {
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
      void close()
    }
    const session = current ?? activate(active.watching)
    startWatcher(session)
  })
  compiler.hooks.beforeRun?.tap('mokup:webpack', () => {
    if (current?.watching) {
      void close()
    }
    if (!current) {
      activate(undefined)
    }
  })
  compiler.hooks.watchClose.tap('mokup:webpack', () => {
    void close()
  })
  compiler.hooks.shutdown?.tapPromise('mokup:webpack', close)

  async function ensureBuilt() {
    const session = current ?? (stopped ? null : activate(compiler.watching))
    return session?.build.ensureBuilt() ?? null
  }

  return {
    ensureBuilt,
    getSession: () => current?.build ?? null,
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
