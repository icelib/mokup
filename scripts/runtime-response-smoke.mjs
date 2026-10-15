import assert from 'node:assert/strict'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const cookies = ['session=abc; HttpOnly', 'theme=dark; Expires=Wed, 21 Oct 2037 07:28:00 GMT']
const bytes = [0, 97, 115, 109, 255, 128, 0]

async function smokeRequestFallthrough(bundle) {
  const payload = '{"hello":"world"}'
  const { createRuntime } = await import('@mokup/runtime')
  const runtime = createRuntime(bundle)
  assert.equal(await runtime.hasRoute({ method: 'POST', path: '/echo' }), true)
  assert.equal(await runtime.hasRoute({ method: 'POST', path: '/resource' }), false)
  assert.equal(await runtime.hasRoute({ method: 'HEAD', path: '/resource' }), true)

  const { createFetchHandler } = await import('mokup/server/fetch')
  const handler = createFetchHandler(bundle)
  for (const pathname of ['/native', '/resource']) {
    const request = new Request(`http://localhost${pathname}`, { method: 'POST', body: payload })
    assert.equal(await handler(request), null)
    assert.equal(request.bodyUsed, false)
    assert.equal(await request.text(), payload)
  }
  const mocked = await handler(new Request('http://localhost/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
  }))
  assert.deepEqual(await mocked.json(), { received: { hello: 'world' } })

  const { createConnectMiddleware } = await import('@mokup/server/connect')
  const middleware = createConnectMiddleware(bundle)
  const server = createServer((req, res) => {
    void middleware(req, res, (error) => {
      if (error) {
        res.statusCode = 500
        res.end(String(error))
        return
      }
      void (async () => {
        let body = ''
        for await (const chunk of req) {
          body += chunk.toString()
        }
        res.end(body)
      })().catch(error => res.destroy(error))
    })
  })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    for (const pathname of ['/native', '/echo']) {
      const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      })
      assert.equal(response.status, 200)
      if (pathname === '/native') {
        assert.equal(await response.text(), payload)
      }
      else {
        assert.deepEqual(await response.json(), { received: { hello: 'world' } })
      }
    }
  }
  finally {
    server.closeAllConnections()
    if (server.listening) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }
}

async function checkResponses(fetchResponse) {
  const get = await fetchResponse('/resource')
  assert.equal(get.headers.get('x-route'), 'get')
  assert.equal(await get.text(), 'GET')
  const head = await fetchResponse('/resource', 'HEAD')
  assert.equal(head.headers.get('x-route'), 'head')
  assert.equal(head.headers.get('content-length'), '4')
  assert.equal(await head.text(), '')
  const fallback = await fetchResponse('/cookies', 'HEAD')
  assert.deepEqual(fallback.headers.getSetCookie(), cookies)
  assert.equal(await fallback.text(), '')
  const cookieResponse = await fetchResponse('/cookies')
  assert.deepEqual(cookieResponse.headers.getSetCookie(), cookies)
  assert.equal(await cookieResponse.text(), 'cookies')
  const binary = await fetchResponse('/binary')
  assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())], bytes)
  for (const status of [204, 205, 304]) {
    const response = await fetchResponse(`/empty-${status}`)
    assert.equal(response.status, status)
    assert.equal(await response.text(), '')
    assert.deepEqual(response.headers.getSetCookie(), cookies)
    assert.equal(response.headers.get('x-route'), 'empty')
    if (status === 304) {
      assert.equal(response.headers.get('content-length'), '7')
    }
    else {
      assert.ok([null, '0'].includes(response.headers.get('content-length')))
      // Node may frame an empty 205 as a terminating zero-length chunk.
      assert.ok((status === 205 ? [null, 'chunked'] : [null]).includes(response.headers.get('transfer-encoding')))
    }
  }
}

export async function smokeResponseContracts(directory, cli, run) {
  const mockDir = path.join(directory, 'response-mock')
  const outputDir = path.join(directory, 'response-output')
  await fs.mkdir(mockDir)
  const cookieHeaders = cookies.map(cookie => ['set-cookie', cookie])
  const fixtures = {
    'resource.get.ts': { handler: '() => new Response(\'GET\', { headers: { \'x-route\': \'get\' } })' },
    'resource.head.ts': { handler: '() => new Response(\'HEAD\', { headers: { \'x-route\': \'head\', \'content-length\': \'4\' } })' },
    'cookies.get.ts': { handler: `() => new Response('cookies', { headers: ${JSON.stringify(cookieHeaders)} })` },
    'binary.get.ts': { handler: `() => new Response(new Uint8Array(${JSON.stringify(bytes)}), { headers: { 'content-type': 'application/wasm' } })` },
    'echo.post.ts': { handler: 'async (c) => c.json({ received: await c.req.json() })' },
  }
  for (const status of [204, 205, 304]) {
    fixtures[`empty-${status}.get.ts`] = {
      status,
      handler: `() => new Response('payload', { headers: ${JSON.stringify([...cookieHeaders, ['content-length', '7'], ['x-route', 'empty']])} })`,
    }
  }
  for (const [filename, fixture] of Object.entries(fixtures)) {
    await fs.writeFile(path.join(mockDir, filename), `export default { ${fixture.status ? `status: ${fixture.status},` : ''} handler: ${fixture.handler} }\n`)
  }
  await run(process.execPath, [cli, 'build', '--dir', mockDir, '--out', outputDir], directory)
  const { default: bundle } = await import(pathToFileURL(path.join(outputDir, 'mokup.bundle.mjs')).href)
  await smokeRequestFallthrough(bundle)
  const { createFetchHandler } = await import('mokup/server/fetch')
  const handler = createFetchHandler({ ...bundle, onNotFound: 'response' })
  await checkResponses((pathname, method = 'GET') => handler(new Request(`http://localhost${pathname}`, { method })))

  const { createFetchServer, serve } = await import('mokup/server/node')
  const dev = await createFetchServer({ entries: { dir: mockDir, watch: false, log: false }, playground: false })
  let server
  try {
    await fs.writeFile(path.join(mockDir, 'refreshed.get.json'), '{"refreshed":true}\n')
    await Promise.all([dev.refresh(), dev.refresh()])
    const refreshed = await dev.fetch(new Request('http://localhost/refreshed'))
    assert.equal(refreshed.status, 200)
    assert.deepEqual(await refreshed.json(), { refreshed: true })
    assert.ok(dev.getRoutes().some(route => route.template === '/refreshed'))
    server = serve({ fetch: dev.fetch, hostname: '127.0.0.1', port: 0 })
    if (!server.listening) {
      await once(server, 'listening')
    }
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    await checkResponses((pathname, method = 'GET') => fetch(`http://127.0.0.1:${address.port}${pathname}`, { method, signal: AbortSignal.timeout(10_000) }))
  }
  finally {
    try {
      server?.closeAllConnections()
      if (server?.listening) {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      }
    }
    finally {
      await dev.close?.()
    }
  }
}
