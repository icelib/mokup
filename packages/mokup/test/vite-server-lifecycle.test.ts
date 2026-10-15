import type { ViteDevServer } from 'vite'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createLogger, createServer } from 'vite'
import { expect, it, vi } from 'vitest'
import mokup from '../src/vite'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function within<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Mock refresh did not reach the expected stage')), 3000)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

async function withServer(run: (server: ViteDevServer, file: string) => Promise<void>) {
  // Vite resolves symlinks; use the same root for watcher events on macOS.
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'mokup-vite-lifecycle-')))
  let server: ViteDevServer | undefined
  try {
    await fs.mkdir(path.join(root, 'mock'))
    const file = path.join(root, 'mock', 'a.get.ts')
    await fs.writeFile(file, 'export default { handler: { value: "initial" } }')
    await fs.writeFile(path.join(root, 'mock', 'b.get.ts'), 'export default { handler: { value: "other" } }')
    const logger = createLogger('silent')
    server = await createServer({
      root,
      configFile: false,
      customLogger: logger,
      plugins: [mokup({ entries: { dir: 'mock', log: false }, playground: false })],
      server: { middlewareMode: true, hmr: false },
    })
    await run(server, file)
  }
  finally {
    try {
      await server?.close()
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }
}

it('drains an active mock scan before closing the real Vite module loader', async () => {
  await withServer(async (server, file) => {
    const entered = deferred()
    const gate = deferred()
    const loadModule = server.ssrLoadModule.bind(server)
    let first = true
    const load = vi.spyOn(server, 'ssrLoadModule').mockImplementation(async (...args) => {
      if (first && args[0].includes('/a.get.ts')) {
        first = false
        entered.resolve()
        await gate.promise
      }
      return loadModule(...args)
    })
    let closing: Promise<void> | undefined
    try {
      server.watcher.emit('change', file)
      await within(entered.promise)
      let closed = false
      closing = server.close().then(() => {
        closed = true
      })
      await delay(50)
      expect(closed).toBe(false)

      server.watcher.emit('change', file)
      gate.resolve()
      await within(closing)
      expect(closed).toBe(true)
      const callsAtClose = load.mock.calls.length
      await delay(100)
      expect(load).toHaveBeenCalledTimes(callsAtClose)
    }
    finally {
      gate.resolve()
      await closing
      load.mockRestore()
    }
  })
})

it('cancels a pending watcher refresh when the real Vite server closes', async () => {
  await withServer(async (server, file) => {
    const load = vi.spyOn(server, 'ssrLoadModule')
    try {
      server.watcher.emit('change', file)
      await server.close()
      await delay(150)
      expect(load).not.toHaveBeenCalled()
    }
    finally {
      load.mockRestore()
    }
  })
})

it('refreshes mock routes after restarting the real Vite server', async () => {
  await withServer(async (server, file) => {
    const previousWatcher = server.watcher
    await server.restart()
    expect(server.watcher).not.toBe(previousWatcher)
    const refreshed = deferred()
    const loadModule = server.ssrLoadModule.bind(server)
    const load = vi.spyOn(server, 'ssrLoadModule').mockImplementation(async (...args) => {
      const result = await loadModule(...args)
      refreshed.resolve()
      return result
    })
    try {
      server.watcher.emit('change', file)
      await within(refreshed.promise)
      expect(load).toHaveBeenCalled()
    }
    finally {
      await server.close()
      load.mockRestore()
    }
  })
})
