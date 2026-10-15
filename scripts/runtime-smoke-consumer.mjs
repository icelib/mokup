import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const consumerDir = dirname(fileURLToPath(import.meta.url))
const mockDir = join(consumerDir, 'mock')
const outDir = join(consumerDir, '.mokup')
const pingBody = { ok: true, source: 'packed-typescript' }

async function checkImports() {
  for (const name of ['mokup', '@mokup/cli', '@mokup/client', '@mokup/core', '@mokup/query', '@mokup/runtime', '@mokup/server', '@mokup/shared']) {
    const resolved = fileURLToPath(import.meta.resolve(name))
    assert(resolved.startsWith(join(consumerDir, 'node_modules')), `${name} must resolve inside the consumer`)
    assert(resolved.includes(`${sep}dist${sep}`), `${name} must import its built entry`)
    await import(name)
  }
  const playgroundHtml = await readFile(join(consumerDir, 'node_modules/@mokup/playground/dist/index.html'), 'utf8')
  assert(playgroundHtml.includes('<html'), 'The playground must contain its built HTML')
}

async function checkCli() {
  await mkdir(mockDir)
  await writeFile(join(mockDir, 'ping.get.ts'), [
    'import { defineHandler } from "mokup"',
    'const body: { ok: boolean, source: string } = { ok: true, source: "packed-typescript" }',
    'export default defineHandler(() => body)',
    '',
  ].join('\n'))
  await writeFile(join(mockDir, 'health.get.json'), '{"ok":true}')
  const cli = join(dirname(fileURLToPath(import.meta.resolve('mokup/cli'))), 'cli-bin.mjs')
  const { stdout } = await execFileAsync(process.execPath, [cli, '--help'], { cwd: consumerDir, timeout: 30_000 })
  assert(stdout.includes('build') && stdout.includes('serve'), 'CLI help must list its commands')
  await execFileAsync(process.execPath, [cli, 'build', '--dir', mockDir, '--out', outDir], {
    cwd: consumerDir,
    timeout: 60_000,
  })
  const manifest = JSON.parse(await readFile(join(outDir, 'mokup.manifest.json'), 'utf8'))
  assert.equal(manifest.routes.length, 2, 'CLI must discover JSON and TypeScript mocks')
  const bundle = await import(pathToFileURL(join(outDir, 'mokup.bundle.mjs')).href)
  return bundle.default
}

async function expectJson(response, expected) {
  assert(response && typeof response.json === 'function', 'Expected a JSON response')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), expected)
}

async function checkFetch(bundle) {
  const { createRuntimeApp } = await import('@mokup/runtime')
  const { createFetchHandler } = await import('mokup/server/fetch')
  const { createMokupWorker } = await import('mokup/server/worker')
  const request = () => new Request('http://localhost/ping')
  const runtime = await createRuntimeApp(bundle)
  await expectJson(await runtime.fetch(request()), pingBody)
  const handler = createFetchHandler({ ...bundle, onNotFound: 'response' })
  await expectJson(await handler(request()), pingBody)
  assert.equal((await handler(new Request('http://localhost/missing'))).status, 404)
  const worker = createMokupWorker(bundle)
  await expectJson(await worker.fetch(request()), pingBody)
}

function readWsMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for a playground WebSocket message'))
    }, 10_000)
    function cleanup() {
      clearTimeout(timer)
      socket.off('message', onMessage)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    function onMessage(data) {
      cleanup()
      try {
        resolve(JSON.parse(data.toString()))
      }
      catch (error) {
        reject(error)
      }
    }
    function onError(error) {
      cleanup()
      reject(error)
    }
    function onClose() {
      cleanup()
      reject(new Error('The playground WebSocket closed before sending its message'))
    }
    socket.once('message', onMessage)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

async function checkNodeServer() {
  const { createFetchServer, serve } = await import('mokup/server/node')
  const serverRequire = createRequire(import.meta.resolve('@mokup/server/node'))
  const { WebSocket } = serverRequire('ws')
  const fetchServer = await createFetchServer({
    entries: { dir: mockDir, log: false, watch: false },
    playground: { enabled: true },
  })
  assert(fetchServer.websocket, 'The packed server must enable WebSocket metrics')
  const server = serve({
    fetch: fetchServer.fetch,
    websocket: fetchServer.websocket,
    hostname: '127.0.0.1',
    port: 0,
  })
  let socket
  try {
    if (!server.listening) {
      await once(server, 'listening')
    }
    const address = server.address()
    assert(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    socket = new WebSocket(`${baseUrl.replace('http:', 'ws:')}/__mokup/ws`)
    const snapshot = await readWsMessage(socket)
    assert.equal(snapshot.type, 'snapshot')
    assert.equal(snapshot.total, 0)
    const [event] = await Promise.all([
      readWsMessage(socket),
      fetch(`${baseUrl}/ping`, { signal: AbortSignal.timeout(10_000) })
        .then(response => expectJson(response, pingBody)),
    ])
    assert.equal(event.type, 'increment')
    assert.equal(event.routeKey, 'GET /ping')
    assert.equal(event.total, 1)
    await expectJson(await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10_000) }), { ok: true })
    const playground = await fetch(`${baseUrl}/__mokup`, { signal: AbortSignal.timeout(10_000) })
    assert.equal(playground.status, 200)
  }
  finally {
    socket?.terminate()
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await fetchServer.close?.()
    await new Promise(resolve => fetchServer.websocket.server.close(resolve))
  }
}

await checkImports()
const bundle = await checkCli()
await checkFetch(bundle)
await checkNodeServer()
process.stdout.write(`runtime smoke passed on ${process.version}: packed imports, CLI, TypeScript bundle, Fetch, HTTP, WebSocket\n`)
