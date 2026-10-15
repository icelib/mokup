import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { createServer, request } from 'node:http'

function readTarget(port, target) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: target, agent: false }, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.once('error', reject)
      res.once('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.setTimeout(10_000, () => req.destroy(new Error(`Request target timed out: ${target}`)))
    req.end()
  })
}

async function checkTargets(adapter, middleware, pathname, checkBody) {
  const server = createServer((req, res) => {
    void middleware(req, res, (error) => {
      res.statusCode = error ? error.statusCode ?? 500 : 404
      res.end(error ? String(error) : 'next')
    })
  })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    for (const scheme of ['ftp', 'ws', 'wss', 'file']) {
      const target = `${scheme}://${scheme === 'file' ? '' : 'mokup.local'}${pathname}`
      const invalid = await readTarget(address.port, target)
      assert.equal(invalid.status, 400, `${adapter} must reject ${target}`)
      const recovered = await readTarget(address.port, pathname)
      assert.equal(recovered.status, 200, `${adapter} must recover after ${target}`)
      checkBody(recovered.body)
    }
    for (const target of [`http://mokup.local${pathname}`, `https://mokup.local${pathname}`, pathname]) {
      const response = await readTarget(address.port, target)
      assert.equal(response.status, 200, `${adapter} must accept ${target}`)
      checkBody(response.body)
    }
    for (const target of [`//mokup.local${pathname}`, `//[${pathname}`]) {
      const response = await readTarget(address.port, target)
      assert.deepEqual(response, { status: 404, body: 'next' }, `${adapter} must preserve the path in ${target}`)
    }
  }
  finally {
    server.closeAllConnections()
    if (server.listening) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }
}

export async function smokeRequestTargets() {
  const { createConnectMiddleware } = await import('@mokup/server/connect')
  const { createExpressMiddleware } = await import('@mokup/server/express')
  const options = {
    manifest: {
      version: 1,
      routes: [{ method: 'GET', url: '/target', response: { type: 'text', body: 'matched' } }],
    },
  }
  const checkMock = body => assert.equal(body, 'matched')
  await checkTargets('Connect', createConnectMiddleware(options), '/target', checkMock)
  await checkTargets('Express', createExpressMiddleware(options), '/target', checkMock)

  const { createHonoApp, createMiddleware } = await import('@mokup/core/middleware')
  const logger = { info() {}, warn() {}, error() {} }
  const app = createHonoApp([{
    file: 'mock/target.get.ts',
    method: 'GET',
    template: '/target',
    tokens: [{ type: 'static', value: 'target' }],
    score: [],
    handler: 'matched',
  }])
  await checkTargets('Core mock', createMiddleware(() => app, logger), '/target', checkMock)

  const { createPlaygroundMiddleware } = await import('@mokup/core/playground/middleware')
  const playground = createPlaygroundMiddleware({
    getRoutes: () => [],
    config: { enabled: true, path: '/__mokup', build: false },
    logger,
  })
  await checkTargets('Core Playground', playground, '/__mokup/routes', (body) => {
    const routes = JSON.parse(body)
    assert.equal(routes.count, 0)
    assert.equal(routes.basePath, '/__mokup')
  })
}
