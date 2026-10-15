import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadModuleWithVite } from '@mokup/core/module-loader'

const consumer = path.dirname(fileURLToPath(import.meta.url))
const version = process.argv[2]
const slash = value => value.replaceAll('\\', '/')
const clean = value => value.split('?')[0]
const requestPaths = (directory, file) => new Set([slash(file), `/${slash(path.relative(directory, file))}`])

async function within(promise, label, timeout = 10_000) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeout)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function counts(server, file) {
  const graph = server.environments?.ssr?.moduleGraph ?? server.moduleGraph
  const runner = server._ssrCompatModuleRunner?.evaluatedModules
  return {
    ids: graph.idToModuleMap.size,
    urls: graph.urlToModuleMap.size,
    fileNodes: graph.getModulesByFile(slash(file))?.size ?? 0,
    runnerIds: runner?.idToModuleMap.size ?? null,
    runnerUrls: runner?.urlToIdModuleMap.size ?? null,
  }
}

async function withResources(vite, action) {
  const temporary = await fs.mkdtemp(path.join(consumer, 'fixture-'))
  let directory = temporary
  const servers = []
  const pending = new Set()
  const releases = []
  const afterLoads = []
  const errors = []
  const scope = {
    directory,
    gate() {
      const gate = deferred()
      releases.push(gate.resolve)
      return gate
    },
    load(server, file) {
      const operation = loadModuleWithVite(server, file)
      const settled = operation.then(
        () => ({ status: 'fulfilled' }),
        reason => ({ status: 'rejected', reason }),
      )
      pending.add(settled)
      void settled.then(() => pending.delete(settled))
      return within(operation, `load ${file}`)
    },
    evaluationGate() {
      const key = `mokup-compat-${randomUUID()}`
      const entered = deferred()
      const release = scope.gate()
      globalThis[key] = { entered: entered.resolve, pending: release.promise }
      afterLoads.push(() => {
        delete globalThis[key]
      })
      return { key, entered, release }
    },
    async server(plugins = [], preserveSymlinks = false, config = {}) {
      let preventedLegacyListen = 0
      const server = await vite.createServer({
        root: directory,
        configFile: false,
        envFile: false,
        publicDir: false,
        cacheDir: path.join(directory, `.cache-${servers.length}`),
        logLevel: 'silent',
        appType: 'custom',
        resolve: { preserveSymlinks },
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { middlewareMode: true, hmr: false, watch: null, ws: false },
        ...config,
        plugins: [{
          name: 'mokup-compat-no-network',
          configureServer(instance) {
            // Vite 5.0 predates ws:false and calls listen after configureServer.
            if (version === '5.0.0') {
              instance.ws.listen = () => {
                preventedLegacyListen++
              }
            }
          },
        }, ...plugins],
      })
      servers.push(server)
      assert.equal(server.httpServer, null)
      assert.deepEqual(server.watcher.getWatched(), {})
      if (version === '5.0.0') {
        assert.ok(preventedLegacyListen > 0, 'Vite 5.0 WebSocket listen must be intercepted')
      }
      return server
    },
  }
  try {
    directory = await fs.realpath(temporary)
    scope.directory = directory
    await fs.writeFile(path.join(directory, 'package.json'), '{"type":"module"}')
    await action(scope)
  }
  catch (error) {
    errors.push(error)
  }
  finally {
    for (const release of releases) {
      release()
    }
    try {
      for (const result of await within(Promise.all([...pending]), 'drain fixture loads')) {
        if (result.status === 'rejected') {
          errors.push(result.reason)
        }
      }
    }
    catch (error) {
      errors.push(error)
    }
    for (const cleanup of afterLoads) {
      cleanup()
    }
    for (const server of servers.reverse()) {
      try {
        await within(server.close(), 'close Vite server')
      }
      catch (error) {
        errors.push(error)
      }
    }
    try {
      await fs.rm(temporary, { recursive: true, force: true })
    }
    catch (error) {
      errors.push(new Error(`Failed to remove fixture ${temporary}`, { cause: error }))
    }
  }
  if (errors.length > 0) {
    throw new AggregateError([...new Set(errors)], `Vite ${version} fixture failed`)
  }
}

export { clean, consumer, counts, deferred, requestPaths, slash, version, within, withResources }
