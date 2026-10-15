import type { PreviewServer, ViteDevServer } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { createServerSession, createServerSessions } from '../src/vite/plugin/server-session'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function watcherController() {
  return { pause: vi.fn(), resume: vi.fn(), close: vi.fn().mockResolvedValue(undefined) }
}

function devServer() {
  return {
    watcher: {},
    ws: {},
    close: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
  } as unknown as ViteDevServer
}

describe('vite server session', () => {
  it('waits for active scans before closing and closes each resource once', async () => {
    const gate = deferred()
    const server = devServer()
    const originalClose = server.close
    const refresh = vi.fn().mockReturnValue(gate.promise)
    const session = createServerSession({ server, refresh, onError: vi.fn() })
    const watcher = watcherController()
    session.attachWatcher(watcher)

    const active = session.refresh()
    await Promise.resolve()
    const queued = session.refresh({ force: true })
    const closing = server.close()
    expect(server.close()).toBe(closing)
    await queued
    await session.refresh()
    expect(originalClose).not.toHaveBeenCalled()
    expect(watcher.close).toHaveBeenCalledTimes(1)

    gate.resolve()
    await Promise.all([active, closing])
    expect(originalClose).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it.each([5, 8])('keeps the new session alive when Vite %s restarts', async (version) => {
    const oldServer = devServer()
    const newServer = devServer()
    const oldClose = oldServer.close
    const newClose = newServer.close
    const oldWatcher = watcherController()
    const newWatcher = watcherController()
    const refresh = vi.fn().mockResolvedValue(undefined)
    const sessions = createServerSessions({ refresh, onError: vi.fn(), onServerChange: vi.fn() })
    oldServer.restart = vi.fn(async () => {
      const next = sessions.start(newServer)
      next.attachWatcher(newWatcher)
      if (version === 5) {
        await oldServer.close()
      }
      Object.assign(oldServer, newServer)
    })
    const session = sessions.start(oldServer)
    session.attachWatcher(oldWatcher)

    await oldServer.restart(true)
    await sessions.refresh(undefined, { force: true })

    expect(oldWatcher.close).toHaveBeenCalledTimes(1)
    expect(oldClose).toHaveBeenCalledTimes(version === 5 ? 1 : 0)
    expect(newWatcher.close).not.toHaveBeenCalled()
    expect(newClose).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledExactlyOnceWith(newServer, { force: true })
    await oldServer.close()
    expect(newWatcher.close).toHaveBeenCalledTimes(1)
    expect(newClose).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('restores the old session after a failed restart (throws=%s)', async (throws) => {
    const server = devServer()
    const error = new Error('Invalid Vite configuration')
    const refresh = vi.fn().mockResolvedValue(undefined)
    const onServerChange = vi.fn()
    const sessions = createServerSessions({ refresh, onError: vi.fn(), onServerChange })
    server.restart = vi.fn(async () => {
      // A configure hook can run before creation of the replacement fails.
      sessions.start(devServer())
      if (throws) {
        throw error
      }
    })
    const session = sessions.start(server)
    const watcher = watcherController()
    session.attachWatcher(watcher)

    const restarting = server.restart()
    if (throws) {
      await expect(restarting).rejects.toBe(error)
    }
    else {
      await restarting
    }
    await sessions.refresh()

    expect(watcher.pause).toHaveBeenCalledTimes(1)
    expect(watcher.resume).toHaveBeenCalledTimes(1)
    expect(watcher.close).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenNthCalledWith(1, server, { force: true })
    expect(refresh).toHaveBeenNthCalledWith(2, server, undefined)
    expect(onServerChange).toHaveBeenLastCalledWith(server)
    await server.close()
  })

  it('drains scans before starting a restart and preserves its arguments', async () => {
    const gate = deferred()
    const server = devServer()
    const originalRestart = server.restart
    const refresh = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(undefined)
    const session = createServerSession({ server, refresh, onError: vi.fn() })
    const active = session.refresh()
    await Promise.resolve()

    const restarting = server.restart(true)
    expect(server.restart()).toBe(restarting)
    await session.refresh()
    expect(originalRestart).not.toHaveBeenCalled()
    gate.resolve()
    await Promise.all([active, restarting])
    expect(originalRestart).toHaveBeenCalledExactlyOnceWith(true)
    await server.close()
  })

  it('keeps scan errors observable while allowing server shutdown to complete', async () => {
    const gate = deferred()
    const error = new Error('Invalid mock module')
    const server = devServer()
    const originalClose = server.close
    const session = createServerSession({
      server,
      refresh: async () => {
        await gate.promise
        throw error
      },
      onError: vi.fn(),
    })
    const active = session.refresh()
    const rejection = expect(active).rejects.toBe(error)
    await Promise.resolve()
    const closing = server.close()
    gate.resolve()
    await rejection
    await closing
    expect(originalClose).toHaveBeenCalledTimes(1)
  })

  it('waits for its preview watcher and scans before closing the preview server', async () => {
    const scanGate = deferred()
    const watcherGate = deferred()
    const originalClose = vi.fn().mockResolvedValue(undefined)
    const server = { close: originalClose } as unknown as PreviewServer
    const session = createServerSession({
      server,
      refresh: () => scanGate.promise,
      onError: vi.fn(),
    })
    const watcher = watcherController()
    watcher.close.mockReturnValue(watcherGate.promise)
    session.attachWatcher(watcher)
    const scan = session.refresh()
    await Promise.resolve()
    const closing = server.close()

    scanGate.resolve()
    await scan
    expect(originalClose).not.toHaveBeenCalled()
    watcherGate.resolve()
    await closing
    expect(originalClose).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('drains direct preview HTTP close and preserves its API (public close=%s)', async (hasPublicClose) => {
    const scanGate = deferred()
    const watcherGate = deferred()
    const originalClose = vi.fn((callback?: (error?: Error) => void) => callback?.())
    const httpServer = { close: originalClose }
    const publicClose = vi.fn().mockResolvedValue(undefined)
    const server = { httpServer, ...(hasPublicClose ? { close: publicClose } : {}) } as unknown as PreviewServer
    const session = createServerSession({ server, refresh: () => scanGate.promise, onError: vi.fn() })
    const watcher = watcherController()
    watcher.close.mockReturnValue(watcherGate.promise)
    session.attachWatcher(watcher)
    const scan = session.refresh()
    await Promise.resolve()
    const done = deferred()
    const callback = vi.fn(() => done.resolve())

    expect(httpServer.close(callback)).toBe(httpServer)
    expect(originalClose).not.toHaveBeenCalled()
    expect(watcher.close).toHaveBeenCalledTimes(1)
    scanGate.resolve()
    await scan
    expect(originalClose).not.toHaveBeenCalled()
    watcherGate.resolve()
    await Promise.all([scan, done.promise])
    expect(originalClose).toHaveBeenCalledExactlyOnceWith(callback)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(publicClose).not.toHaveBeenCalled()
    await session.close()
    expect(watcher.close).toHaveBeenCalledTimes(1)
  })

  it('allows public preview close to close HTTP without waiting on itself', async () => {
    const gate = deferred()
    const originalHttpClose = vi.fn((callback?: (error?: Error) => void) => callback?.())
    const httpServer = { close: originalHttpClose }
    const originalClose = vi.fn(() => new Promise<void>((resolve, reject) => {
      httpServer.close(error => error ? reject(error) : resolve())
    }))
    const server = { httpServer, close: originalClose } as unknown as PreviewServer
    const session = createServerSession({ server, refresh: () => gate.promise, onError: vi.fn() })
    const watcher = watcherController()
    session.attachWatcher(watcher)
    const scan = session.refresh()
    await Promise.resolve()

    const closing = server.close()
    expect(server.close()).toBe(closing)
    expect(originalClose).not.toHaveBeenCalled()
    expect(originalHttpClose).not.toHaveBeenCalled()
    gate.resolve()
    await Promise.all([scan, closing])

    expect(watcher.close).toHaveBeenCalledTimes(1)
    expect(originalClose).toHaveBeenCalledTimes(1)
    expect(originalHttpClose).toHaveBeenCalledTimes(1)
  })

  it('leaves dev HTTP close under Vite restart ownership', async () => {
    const originalHttpClose = vi.fn()
    const server = devServer()
    server.httpServer = { close: originalHttpClose } as unknown as ViteDevServer['httpServer']
    const session = createServerSession({ server, refresh: vi.fn(), onError: vi.fn() })

    expect(server.httpServer?.close).toBe(originalHttpClose)
    await session.close()
  })
})
