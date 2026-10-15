import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { createServer } from 'node:http'

export async function smokeClientRequests() {
  const { createFetchAdapter, createAxiosRequestInterceptor } = await import('@mokup/client')
  const server = createServer((request, response) => {
    void (async () => {
      const chunks = []
      for await (const chunk of request) {
        chunks.push(chunk)
      }
      if (request.url === '/redirect') {
        response.writeHead(307, { location: '/echo' }).end()
        return
      }
      if (request.url === '/error') {
        response.writeHead(503, { 'content-type': 'application/json' })
        response.end('{"message":"try later"}')
        return
      }
      if (['/no-content', '/reset-content', '/empty-json'].includes(request.url)) {
        const status = request.url === '/no-content' ? 204 : request.url === '/reset-content' ? 205 : 200
        response.writeHead(status, { 'content-type': 'application/json' }).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        method: request.method,
        url: request.url,
        contentType: request.headers['content-type'],
        marker: request.headers['x-mokup-mode'],
        body: Buffer.concat(chunks).toString('base64'),
      }))
    })().catch(error => response.destroy(error))
  })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    const plain = createFetchAdapter({ resolverOptions: { markers: { header: true } } })
    const rewritten = createFetchAdapter({ resolverOptions: { realBase: origin, markers: { header: true } } })
    for (const [adapter, source] of [[plain, origin], [rewritten, 'http://unused.invalid']]) {
      const response = await adapter(new Request(`${source}/redirect`, {
        method: 'POST',
        body: 'request payload',
        keepalive: true,
        signal: AbortSignal.timeout(10_000),
      }), { body: null, method: undefined, signal: undefined })
      assert.equal(response.status, 200)
      const result = await response.json()
      assert.equal(result.method, 'POST')
      assert.equal(result.url, '/echo')
      assert.equal(result.marker, 'real')
      assert.equal(Buffer.from(result.body, 'base64').toString(), 'request payload')
    }
    const bytes = new Uint8Array([0, 255, 128, 1])
    const form = new FormData()
    form.set('name', 'mokup')
    form.set('file', new Blob([bytes]), 'payload.bin')
    const response = await rewritten(new Request('http://unused.invalid/echo', {
      method: 'POST',
      body: form,
      keepalive: true,
      signal: AbortSignal.timeout(10_000),
    }))
    const result = await response.json()
    const received = await new Response(Buffer.from(result.body, 'base64'), {
      headers: { 'content-type': result.contentType },
    }).formData()
    assert.equal(received.get('name'), 'mokup')
    assert.deepEqual(new Uint8Array(await received.get('file').arrayBuffer()), bytes)

    const interceptor = createAxiosRequestInterceptor()
    const config = await interceptor({ baseURL: `${origin}/api/v1`, url: '/users' })
    assert.equal(config.url, `${origin}/api/v1/users`)
    assert.equal(config.baseURL, '')
    const { createAxiosExecutor } = await import('@mokup/query')
    const axios = {
      defaults: { baseURL: `${origin}/api/v1` },
      request: async config => ({ data: config.url }),
    }
    const executor = createAxiosExecutor({ axios })
    assert.equal(await executor({ url: '/users' }), `${origin}/api/v1/users`)
    axios.defaults.baseURL = `${origin}/api/v2`
    assert.equal(await executor({ url: '/users' }), `${origin}/api/v2/users`)
    const rawError = await plain(`${origin}/error`)
    assert.equal(rawError.status, 503)
    assert.deepEqual(await rawError.json(), { message: 'try later' })
    await smokeQueryRequests(origin)
  }
  finally {
    server.closeAllConnections()
    if (server.listening) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }
}

async function smokeQueryRequests(origin) {
  const { createMokupQueryClient, createFetchExecutor, MokupHttpError } = await import('@mokup/query')
  const resolverOptions = { realBase: origin, markers: { header: true } }
  const { queryFn, mutationFn } = createMokupQueryClient({ resolverOptions })
  assert.equal(await queryFn({ queryKey: ['HEAD', '/echo'], signal: AbortSignal.timeout(10_000) }), '')
  assert.equal(await mutationFn({ url: '/no-content', method: 'DELETE' }), '')
  assert.equal(await mutationFn({ url: '/reset-content', method: 'POST' }), '')
  await assert.rejects(queryFn({ queryKey: ['/empty-json'], signal: AbortSignal.timeout(10_000) }), SyntaxError)
  await assert.rejects(queryFn({ queryKey: ['HEAD', '/error'], signal: AbortSignal.timeout(10_000) }), (error) => {
    assert.ok(error instanceof MokupHttpError)
    assert.equal(error.status, 503)
    assert.equal(error.response.bodyUsed, false)
    return true
  })
  const body = { name: 'mokup', nested: { enabled: true } }
  const result = await mutationFn({ url: '/echo', method: 'POST', body, params: { page: 2 } })
  assert.equal(result.url, '/echo?page=2')
  assert.equal(result.contentType, 'application/json')
  assert.equal(result.marker, 'real')
  assert.deepEqual(JSON.parse(Buffer.from(result.body, 'base64').toString()), body)

  const array = await queryFn({
    queryKey: ['POST', '/echo', { body: [1, 2], headers: { 'Content-Type': 'application/vnd.mokup+json' } }],
    signal: AbortSignal.timeout(10_000),
  })
  assert.equal(array.contentType, 'application/vnd.mokup+json')
  assert.equal(Buffer.from(array.body, 'base64').toString(), '[1,2]')

  const bytes = new Uint8Array([0, 255, 128, 1])
  const binary = await mutationFn({ url: '/echo', method: 'POST', body: bytes.subarray(1, 3) })
  assert.deepEqual(Buffer.from(binary.body, 'base64'), Buffer.from([255, 128]))
  assert.equal(binary.contentType, undefined)
  const form = new FormData()
  form.set('name', 'mokup')
  form.set('file', new Blob([bytes]), 'query.bin')
  const multipart = await mutationFn({ url: '/echo', method: 'POST', body: form })
  const decoded = await new Response(Buffer.from(multipart.body, 'base64'), {
    headers: { 'content-type': multipart.contentType },
  }).formData()
  assert.equal(decoded.get('name'), 'mokup')
  assert.deepEqual(new Uint8Array(await decoded.get('file').arrayBuffer()), bytes)

  let httpError
  await assert.rejects(queryFn({ queryKey: ['/error'], signal: AbortSignal.timeout(10_000) }), (error) => {
    assert.ok(error instanceof MokupHttpError)
    assert.equal(error.name, 'MokupHttpError')
    assert.equal(error.status, 503)
    assert.equal(error.statusText, 'Service Unavailable')
    assert.equal(error.response.bodyUsed, false)
    httpError = error
    return true
  })
  assert.deepEqual(await httpError.response.json(), { message: 'try later' })
  const custom = createFetchExecutor({
    resolverOptions,
    async transformResponse(response) {
      await response.text()
      return response.status
    },
  })
  assert.equal(await custom({ url: '/error' }), 503)
}
