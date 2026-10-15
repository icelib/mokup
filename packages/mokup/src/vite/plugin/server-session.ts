import type { PreviewServer, ViteDevServer } from 'vite'
import type { RefreshOptions } from './refresh-controller'
import type { WatcherController } from './watcher'
import { createRefreshController } from './refresh-controller'
import { isViteDevServer } from './server'

interface ServerSessionOptions {
  server: ViteDevServer | PreviewServer
  refresh: (server: ViteDevServer | PreviewServer, options?: RefreshOptions) => Promise<void>
  onError: (error: unknown) => void
  onResume?: () => void | Promise<void>
}

/** Own refresh work for one server generation, including across Vite restarts. */
export function createServerSession(options: ServerSessionOptions) {
  const { server, onError } = options
  const originalWatcher = isViteDevServer(server) ? server.watcher : undefined
  const controller = createRefreshController(refreshOptions => options.refresh(server, refreshOptions))
  let watcher: WatcherController | null = null
  let paused = false
  let disposed = false
  let disposal: Promise<void> | null = null

  const pause = () => {
    paused = true
    watcher?.pause()
    return controller.pause()
  }
  const dispose = () => {
    if (!disposal) {
      disposed = true
      paused = true
      const drain = controller.close()
      const closeWatcher = watcher?.close()
      disposal = Promise.allSettled([drain, closeWatcher]).then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') {
            onError(result.reason)
          }
        }
      })
    }
    return disposal
  }

  if (typeof server.close === 'function') {
    const originalClose = server.close
    let closing: Promise<void> | null = null
    server.close = () => {
      closing ??= dispose().then(() => originalClose.call(server))
      return closing
    }
  }
  // Preview also allows closing its HTTP server directly (the only close API in
  // Vite 5.0). Dev HTTP shutdown belongs to Vite's restart lifecycle instead.
  if (!isViteDevServer(server) && server.httpServer) {
    const httpServer = server.httpServer
    const originalClose = httpServer.close as (callback?: (error?: Error) => void) => unknown
    httpServer.close = ((callback?: (error?: Error) => void) => {
      void dispose().then(() => originalClose.call(httpServer, callback)).catch((error: unknown) => {
        onError(error)
        callback?.(error instanceof Error ? error : new Error(String(error)))
      })
      return httpServer
    }) as typeof httpServer.close
  }

  if (isViteDevServer(server) && typeof server.restart === 'function') {
    const originalRestart = server.restart
    let restarting: Promise<void> | null = null
    server.restart = (forceOptimize) => {
      restarting ??= (async () => {
        await pause()
        try {
          await originalRestart.call(server, forceOptimize)
        }
        finally {
          // Vite 5–7 call public close during restart; it must never wait for this
          // restart promise. Vite 8 replaces the watcher without calling close.
          if (server.watcher !== originalWatcher) {
            await dispose()
          }
          else if (!disposed) {
            paused = false
            controller.resume()
            watcher?.resume()
            await options.onResume?.()
            // A failed restart keeps the old server alive. Catch up with changes
            // made while its watcher was paused.
            await controller.refresh({ force: true }).catch(onError)
          }
        }
      })().finally(() => {
        restarting = null
      })
      return restarting
    }
  }

  return {
    server,
    refresh: controller.refresh,
    close: dispose,
    attachWatcher(value: WatcherController | null | undefined) {
      watcher = value ?? null
      if (disposed) {
        void watcher?.close().catch(onError)
      }
      else if (paused) {
        watcher?.pause()
      }
    },
  }
}

export type ServerSession = ReturnType<typeof createServerSession>

export function createServerSessions(options: {
  refresh: (server?: ViteDevServer | PreviewServer, options?: RefreshOptions) => Promise<void>
  onError: (error: unknown) => void
  onServerChange: (server: ViteDevServer | PreviewServer) => void
}) {
  let current: ServerSession | null = null
  return {
    refresh(server?: ViteDevServer | PreviewServer, refreshOptions?: RefreshOptions) {
      return current ? current.refresh(refreshOptions) : options.refresh(server, refreshOptions)
    },
    start(server: ViteDevServer | PreviewServer) {
      const session = createServerSession({
        server,
        refresh: options.refresh,
        onError: options.onError,
        onResume: async () => {
          const abandoned = current
          current = session
          if (abandoned !== session) {
            await abandoned?.close()
          }
          options.onServerChange(server)
        },
      })
      current = session
      options.onServerChange(server)
      return session
    },
  }
}
