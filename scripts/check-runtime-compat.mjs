import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { smokeClientRequests } from './runtime-client-smoke.mjs'
import { smokeExternalHandlers } from './runtime-external-handlers-smoke.mjs'
import { smokeModuleRefresh } from './runtime-module-smoke.mjs'
import { smokeRequestBytes } from './runtime-request-bytes-smoke.mjs'
import { smokeRequestTargets } from './runtime-request-target-smoke.mjs'
import { smokeResponseContracts } from './runtime-response-smoke.mjs'
import { smokeRouteGrammar } from './runtime-route-smoke.mjs'
import { smokeTypeScriptModules, smokeTypeScriptSymlinks } from './runtime-typescript-smoke.mjs'

const execFileAsync = promisify(execFile)
const scriptFile = fileURLToPath(import.meta.url)

async function readJson(filename) {
  return JSON.parse(await fs.readFile(filename, 'utf8'))
}

async function run(command, args, cwd) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    env: { ...process.env, HUSKY: '0' },
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (stdout) {
    process.stdout.write(stdout)
  }
  if (stderr) {
    process.stderr.write(stderr)
  }
  return stdout
}

async function publicPackages(root) {
  const result = []
  const packagesDir = path.join(root, 'packages')
  for (const entry of await fs.readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const manifest = await readJson(path.join(packagesDir, entry.name, 'package.json'))
    if (!manifest.private) {
      result.push(manifest)
    }
  }
  assert.ok(result.length > 0, 'No publishable packages found')
  return result.sort((left, right) => left.name.localeCompare(right.name))
}

async function prepareConsumer(root, directory, packages) {
  const packDir = path.join(directory, 'tarballs')
  await fs.mkdir(packDir)
  const dependencies = {}
  for (const pkg of packages) {
    const before = new Set(await fs.readdir(packDir))
    await run('pnpm', ['--filter', pkg.name, 'pack', '--pack-destination', packDir], root)
    const added = (await fs.readdir(packDir)).filter(filename => !before.has(filename))
    assert.equal(added.length, 1, `Expected one tarball for ${pkg.name}`)
    dependencies[pkg.name] = `file:${path.join(packDir, added[0])}`
  }
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({
    name: 'mokup-runtime-compat-consumer',
    private: true,
    type: 'module',
    dependencies,
  }, null, 2))
  await fs.writeFile(path.join(directory, 'runtime-packages.json'), JSON.stringify(packages))
  await fs.copyFile(scriptFile, path.join(directory, 'smoke.mjs'))
  await fs.copyFile(new URL('./runtime-response-smoke.mjs', import.meta.url), path.join(directory, 'runtime-response-smoke.mjs'))
  await fs.copyFile(new URL('./runtime-client-smoke.mjs', import.meta.url), path.join(directory, 'runtime-client-smoke.mjs'))
  await fs.copyFile(new URL('./runtime-external-handlers-smoke.mjs', import.meta.url), path.join(directory, 'runtime-external-handlers-smoke.mjs'))
  await fs.copyFile(new URL('./runtime-module-smoke.mjs', import.meta.url), path.join(directory, 'runtime-module-smoke.mjs'))
  await fs.copyFile(new URL('./runtime-request-bytes-smoke.mjs', import.meta.url), path.join(directory, 'runtime-request-bytes-smoke.mjs'))
  await fs.copyFile(new URL('./runtime-request-target-smoke.mjs', import.meta.url), path.join(directory, 'runtime-request-target-smoke.mjs'))
  await fs.copyFile(new URL('./runtime-route-smoke.mjs', import.meta.url), path.join(directory, 'runtime-route-smoke.mjs'))
  await fs.copyFile(new URL('./runtime-typescript-smoke.mjs', import.meta.url), path.join(directory, 'runtime-typescript-smoke.mjs'))
  // Install only tarball dependencies on the build Node; no workspace tooling or optional peers.
  await run('npm', ['install', '--omit=dev', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'], directory)
}

async function importPublicEntries(directory) {
  const packages = await readJson(path.join(directory, 'runtime-packages.json'))
  let entries = 0
  for (const pkg of packages) {
    const installed = await readJson(path.join(directory, 'node_modules', pkg.name, 'package.json'))
    assert.equal(installed.version, pkg.version, `Expected locally packed ${pkg.name}`)
    for (const subpath of Object.keys(installed.exports ?? {})) {
      assert.ok(subpath.startsWith('.') && !subpath.includes('*'), `Unsupported export ${pkg.name}/${subpath}`)
      const specifier = subpath === '.' ? pkg.name : `${pkg.name}${subpath.slice(1)}`
      await import(specifier)
      entries++
    }
  }
  await fs.access(path.join(directory, 'node_modules/@mokup/playground/dist/index.html'))
  return entries
}

async function smokeBuiltHandlers(directory) {
  const mockDir = path.join(directory, 'mock')
  const outputDir = path.join(directory, 'output')
  await fs.mkdir(mockDir)
  await fs.writeFile(path.join(mockDir, 'hello.get.ts'), [
    'export default {',
    '  handler: (context: { json: (value: unknown) => Response }) => context.json({ ok: true }),',
    '}',
    '',
  ].join('\n'))
  const manifest = await readJson(path.join(directory, 'node_modules/mokup/package.json'))
  const cli = path.join(directory, 'node_modules/mokup', manifest.bin.mokup)
  const checked = JSON.parse(await run(process.execPath, [cli, 'check', '--dir', mockDir, '--json'], directory))
  assert.equal(checked.schemaVersion, 1)
  assert.equal(checked.valid, true)
  assert.equal(checked.routeCount, 1)
  assert.deepEqual(checked.diagnostics, [])
  await assert.rejects(fs.access(path.join(directory, '.mokup')), { code: 'ENOENT' })
  await run(process.execPath, [cli, 'build', '--dir', mockDir, '--out', outputDir], directory)
  const bundle = await import(pathToFileURL(path.join(outputDir, 'mokup.bundle.mjs')).href)
  assert.equal(bundle.default.manifest.routes.length, 1)
  const { createFetchHandler } = await import('mokup/server/fetch')
  const handler = createFetchHandler({ ...bundle.default, onNotFound: 'response' })
  const response = await handler(new Request('http://localhost/hello'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal((await handler(new Request('http://localhost/missing'))).status, 404)

  const { serve } = await import('mokup/server/node')
  const server = serve({ fetch: handler, hostname: '127.0.0.1', port: 0 })
  try {
    if (!server.listening) {
      await once(server, 'listening')
    }
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const networkResponse = await fetch(`http://127.0.0.1:${address.port}/hello`, {
      signal: AbortSignal.timeout(10_000),
    })
    assert.equal(networkResponse.status, 200)
    assert.deepEqual(await networkResponse.json(), { ok: true })
  }
  finally {
    server.closeAllConnections()
    if (server.listening) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }
  await smokeResponseContracts(directory, cli, run)
  await smokeRequestBytes(directory, cli, run)
  await smokeRequestTargets()
  await smokeRouteGrammar(directory, cli, run)
  await smokeExternalHandlers(directory, cli, run)
}

async function smokePlaygroundWebSocket(directory) {
  const { createFetchServer, serve } = await import('mokup/server/node')
  const { WebSocket } = createRequire(import.meta.resolve('@mokup/server'))('ws')
  const fetchServer = await createFetchServer({
    entries: { dir: path.join(directory, 'mock'), watch: false, log: false },
    playground: { enabled: true },
  })
  const pending = new AbortController()
  const signal = AbortSignal.any([pending.signal, AbortSignal.timeout(10_000)])
  let server
  let socket
  try {
    assert.ok(fetchServer.websocket, 'Published server must expose WebSocket options')
    assert.equal(fetchServer.websocket.server.options.noServer, true)
    server = serve({
      fetch: fetchServer.fetch,
      websocket: fetchServer.websocket,
      hostname: '127.0.0.1',
      port: 0,
    })
    if (!server.listening) {
      await once(server, 'listening', { signal })
    }
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    socket = new WebSocket(`ws://127.0.0.1:${address.port}/__mokup/ws`)
    const readMessage = async () => {
      const [data] = await once(socket, 'message', { signal })
      return JSON.parse(data.toString())
    }
    assert.deepEqual(await readMessage(), { type: 'snapshot', total: 0, perRoute: {} })
    const [increment, response] = await Promise.all([
      readMessage(),
      fetch(`http://127.0.0.1:${address.port}/hello`, { signal }),
    ])
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.deepEqual(increment, { type: 'increment', routeKey: 'GET /hello', total: 1 })
  }
  finally {
    pending.abort()
    // Terminating an incomplete handshake emits an expected error during cleanup.
    if (socket?.readyState === WebSocket.CONNECTING) {
      socket.once('error', () => {})
    }
    socket?.terminate()
    try {
      server?.closeAllConnections()
      if (server?.listening) {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      }
      else {
        fetchServer.websocket?.server.close()
      }
    }
    finally {
      await fetchServer.close?.()
    }
  }
}

async function main() {
  if (process.argv[2] === '--typescript-symlinks') {
    await smokeTypeScriptSymlinks(path.dirname(scriptFile))
    process.stdout.write('TypeScript symlink package scopes passed\n')
    return
  }
  if (process.argv[2] === '--consumer') {
    const directory = path.dirname(scriptFile)
    const entries = await importPublicEntries(directory)
    await smokeTypeScriptModules(directory)
    await smokeTypeScriptSymlinks(directory)
    await run(process.execPath, ['--preserve-symlinks', scriptFile, '--typescript-symlinks'], directory)
    await smokeBuiltHandlers(directory)
    await smokePlaygroundWebSocket(directory)
    await smokeClientRequests()
    await smokeModuleRefresh(directory)
    process.stdout.write(`runtime compatibility ok (Node ${process.version}, ${entries} exports, CLI check/build, external handlers and middleware, HTTP/HEAD/cookies/binary/bodyless responses, HTTP request targets, request body fallthrough, binary requests and multipart uploads, WebSocket metrics, Fetch Request, Query HTTP/JSON and Axios URL semantics, native module refresh, CommonJS/ESM TypeScript, literal route grammar)\n`)
    return
  }
  const args = process.argv.slice(2)
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--node-bin'), 'Usage: node scripts/check-runtime-compat.mjs [--node-bin /path/to/node]')
  const runtimeNode = args[1] ?? process.execPath
  const root = path.resolve(path.dirname(scriptFile), '..')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mokup-runtime-compat-'))
  try {
    await prepareConsumer(root, directory, await publicPackages(root))
    await run(runtimeNode, [path.join(directory, 'smoke.mjs'), '--consumer'], directory)
  }
  finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`runtime compatibility failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
