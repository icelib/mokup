import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { createConnectMiddleware } from '../../src/connect.ts'
import { createExpressMiddleware } from '../../src/express.ts'

function sendRequest(port, path, host = 'localhost') {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host }, agent: false }, (res) => {
      res.resume()
      res.once('end', () => resolve(res.statusCode))
      res.once('error', reject)
    })
    req.once('error', reject)
    req.end()
  })
}

for (const createMiddleware of [createConnectMiddleware, createExpressMiddleware]) {
  const middleware = createMiddleware({
    manifest: {
      version: 1,
      routes: [{ method: 'GET', url: '/healthy', response: { type: 'text', body: 'ok' } }],
    },
  })
  const server = createServer((req, res) => {
    void middleware(req, res, (error) => {
      res.statusCode = error ? error.statusCode ?? 500 : 404
      res.end()
    })
  })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address()
    assert.equal(await sendRequest(port, '/', '['), 400)
    assert.equal(await sendRequest(port, 'http://['), 400)
    assert.equal(await sendRequest(port, '//['), 404)
    assert.equal(await sendRequest(port, '/healthy'), 200)
  }
  finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
  }
}

process.stdout.write('HTTP adapters survived malformed requests\n')
