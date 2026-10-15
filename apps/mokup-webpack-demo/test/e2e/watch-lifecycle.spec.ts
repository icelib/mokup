import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Compiler, Configuration, Watching } from 'webpack'
import type {} from 'webpack-dev-server'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import chokidar from '@mokup/shared/chokidar'
import { expect, test } from '@playwright/test'
import { mokupWebpack } from 'mokup/webpack'
import webpack from 'webpack'

type Middleware = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void | Promise<void>
interface DevServerOptions {
  setupMiddlewares?: (
    middlewares: Array<{ name?: string, middleware: Middleware }>,
    server: object,
  ) => Array<{ name?: string, middleware: Middleware }>
}

interface ObservedWatcher {
  isReady: () => boolean
  start: () => void
  changes: string[]
}

const appRoot = fileURLToPath(new URL('../..', import.meta.url))

function startWatching(compiler: Compiler, record: (error: Error | null) => void) {
  let started!: () => void
  let failed!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    started = resolve
    failed = reject
  })
  const watching = compiler.watch({ aggregateTimeout: 20 }, (error, stats) => {
    const failure = error ?? (stats?.hasErrors() ? new Error(stats.toString({ all: false, errors: true })) : null)
    record(failure)
    if (failure) {
      failed(failure)
    }
    else {
      started()
    }
  })
  return { watching, ready }
}

function closeWatching(watching: Watching) {
  return new Promise<void>((resolve, reject) => watching.close(error => error ? reject(error) : resolve()))
}

async function cleanup(compiler: Compiler | undefined, watching: Watching | undefined, server: Server | undefined, directory: string) {
  const errors: unknown[] = []
  try {
    if (watching) {
      await closeWatching(watching)
    }
  }
  catch (error) {
    errors.push(error)
  }
  try {
    if (compiler) {
      await new Promise<void>((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()))
    }
  }
  catch (error) {
    errors.push(error)
  }
  try {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
        server.closeAllConnections()
      })
    }
  }
  catch (error) {
    errors.push(error)
  }
  try {
    await fs.rm(directory, { recursive: true, force: true })
  }
  catch (error) {
    errors.push(error)
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Failed to clean up Webpack watch lifecycle fixture')
  }
}

test('Webpack watch catches startup edits and restarts without reinstalling middleware', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'mokup-webpack-watch-'))
  const mockDir = path.join(directory, 'mock')
  const mockFile = path.join(mockDir, 'value.get.json')
  let compiler: Compiler | undefined
  let watching: Watching | undefined
  let server: Server | undefined
  let compilations = 0
  let invalidations = 0
  let completedInvalidations = 0
  let setupCalls = 0
  const observedWatchers: ObservedWatcher[] = []
  const originalWatch = chokidar.watch
  chokidar.watch = (paths, options) => {
    if (!(Array.isArray(paths) ? paths : [paths]).includes(mockDir)) {
      return originalWatch(paths, options)
    }
    // Keep the first real watcher before its initial scan until the edit is on disk.
    // Chokidar then sees that edit as initial state, without emitting a change.
    const watcher = originalWatch(observedWatchers.length === 0 ? [] : paths, options)
    const changes: string[] = []
    let ready = false
    watcher.on('change', file => changes.push(file))
    watcher.once('ready', () => {
      ready = true
    })
    observedWatchers.push({
      isReady: () => ready,
      start: () => {
        watcher.add(paths)
      },
      changes,
    })
    return watcher
  }
  const compileErrors: Error[] = []
  const record = (error: Error | null) => {
    compilations++
    completedInvalidations = invalidations
    if (error) {
      compileErrors.push(error)
    }
  }
  const writeValue = (value: number) => fs.writeFile(mockFile, JSON.stringify({ value }))
  try {
    await fs.mkdir(mockDir)
    await fs.writeFile(path.join(directory, 'entry.js'), 'export default null\n')
    await writeValue(1)
    const configuration = mokupWebpack({ entries: { dir: mockDir, log: false }, playground: false })({
      mode: 'development',
      context: appRoot,
      entry: path.join(directory, 'entry.js'),
      output: { path: path.join(directory, 'dist'), filename: 'bundle.js', publicPath: '/' },
      cache: false,
      devtool: false,
      devServer: {
        setupMiddlewares(middlewares) {
          setupCalls++
          return middlewares
        },
      },
    } satisfies Configuration)
    const created = webpack(configuration)
    if (!created) {
      throw new Error('Webpack did not create a compiler')
    }
    compiler = created
    compiler.hooks.invalid.tap('watch-lifecycle-test', () => {
      invalidations++
    })
    const first = startWatching(compiler, record)
    watching = first.watching
    await first.ready
    if (!watching) {
      throw new Error('Webpack did not start watching')
    }

    // Webpack's first watchRun can precede the dev server middleware setup.
    const setup = (compiler.options as typeof compiler.options & { devServer?: DevServerOptions }).devServer?.setupMiddlewares
    if (!setup) {
      throw new Error('Mokup did not install setupMiddlewares')
    }
    const mockMiddleware = setup([], {}).find(entry => entry.name === 'mokup-mock')?.middleware
    if (!mockMiddleware) {
      throw new Error('Mokup mock middleware is missing')
    }
    server = createServer((req, res) => {
      void mockMiddleware(req, res, (error) => {
        res.statusCode = error ? 500 : 404
        res.end(error ? String(error) : 'No mock matched')
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP server address')
    }
    const readValue = async () => {
      expect(compileErrors).toEqual([])
      const response = await fetch(`http://127.0.0.1:${address.port}/value`, { signal: AbortSignal.timeout(5000) })
      expect(response.status).toBe(200)
      return response.json()
    }
    await expect.poll(readValue).toEqual({ value: 1 })
    await expect.poll(() => observedWatchers.length).toBe(1)
    const initialWatcher = observedWatchers[0]!
    expect(initialWatcher.isReady()).toBe(false)
    const beforeReady = compilations
    const invalidationsBeforeReady = invalidations
    await writeValue(2)
    expect(initialWatcher.isReady()).toBe(false)
    initialWatcher.start()
    await expect.poll(initialWatcher.isReady).toBe(true)
    expect(initialWatcher.changes).toEqual([])
    await expect.poll(() => completedInvalidations).toBeGreaterThan(invalidationsBeforeReady)
    await expect.poll(() => compilations).toBeGreaterThan(beforeReady)
    await expect.poll(readValue).toEqual({ value: 2 })
    expect(initialWatcher.changes).toEqual([])

    const beforeRefresh = compilations
    await writeValue(3)
    await expect.poll(() => initialWatcher.changes).toContain(mockFile)
    await expect.poll(readValue).toEqual({ value: 3 })
    await expect.poll(() => compilations).toBeGreaterThan(beforeRefresh)

    await closeWatching(watching)
    watching = undefined
    const closedCompilations = compilations
    await writeValue(4)
    for (let observation = 0; observation < 3; observation++) {
      await delay(150)
      expect(await readValue()).toEqual({ value: 3 })
      expect(compilations).toBe(closedCompilations)
    }

    const invalidationsBeforeRestart = invalidations
    const second = startWatching(compiler, record)
    watching = second.watching
    await second.ready
    await expect.poll(() => observedWatchers.length).toBe(2)
    const restartedWatcher = observedWatchers[1]!
    await expect.poll(restartedWatcher.isReady).toBe(true)
    await expect.poll(() => completedInvalidations).toBeGreaterThan(invalidationsBeforeRestart)
    await expect.poll(readValue).toEqual({ value: 4 })
    const beforeSecondRefresh = compilations
    await writeValue(5)
    await expect.poll(() => restartedWatcher.changes).toContain(mockFile)
    await expect.poll(readValue).toEqual({ value: 5 })
    await expect.poll(() => compilations).toBeGreaterThan(beforeSecondRefresh)
    expect(setupCalls).toBe(1)
    expect(compileErrors).toEqual([])
  }
  finally {
    chokidar.watch = originalWatch
    await cleanup(compiler, watching, server, directory)
    expect(server?.listening ?? false).toBe(false)
    await expect(fs.access(directory)).rejects.toMatchObject({ code: 'ENOENT' })
  }
})
