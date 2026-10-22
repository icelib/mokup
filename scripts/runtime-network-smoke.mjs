import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { createServer, request } from 'node:http'

function clientRequest(url, body = '') {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: body ? 'POST' : 'GET' }, (response) => {
      const chunks = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('error', reject)
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

/** Exercise the packed outgoing-request API on each supported Node release. */
export async function smokeNetworkInterception() {
  const { setupServer } = await import('mokup/node')
  const { http, HttpResponse, delay, networkError, passthrough } = await import('mokup/http')
  const nativeFetch = globalThis.fetch
  const backend = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk))
    }
    response.end(`real:${Buffer.concat(chunks).toString()}`)
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const address = backend.address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  const server = setupServer(
    http.post(`${origin}/mock/:id`, async ({ params, request }) => HttpResponse.json({
      id: params.id,
      body: await request.text(),
    }, { status: 201 })),
    http.post(`${origin}/real`, async ({ request }) => {
      await request.text()
      return passthrough()
    }),
    http.get(`${origin}/value`, () => HttpResponse.text('base')),
    http.get(`${origin}/error`, () => networkError()),
  )
  try {
    server.listen()
    const fetched = await fetch(`${origin}/mock/fetch`, { method: 'POST', body: 'fetch-body' })
    assert.equal(fetched.status, 201)
    assert.deepEqual(await fetched.json(), { id: 'fetch', body: 'fetch-body' })
    const native = await clientRequest(`${origin}/mock/http`, 'http-body')
    assert.equal(native.status, 201)
    assert.deepEqual(JSON.parse(native.body), { id: 'http', body: 'http-body' })
    assert.equal(await (await fetch(`${origin}/real`, { method: 'POST', body: 'preserved' })).text(), 'real:preserved')
    await assert.rejects(fetch(`${origin}/error`))

    const boundary = server.boundary(async (value) => {
      server.use(http.get(`${origin}/value`, async () => {
        await delay(1)
        return HttpResponse.text(value)
      }))
      return (await clientRequest(`${origin}/value`)).body
    })
    assert.deepEqual(await Promise.all([boundary('one'), boundary('two')]), ['one', 'two'])
    assert.equal(await (await fetch(`${origin}/value`)).text(), 'base')

    let notifyEntered = () => {}
    const entered = new Promise((resolve) => {
      notifyEntered = resolve
    })
    let finalized = 0
    server.use(http.get(`${origin}/pending`, async ({ request, finalize }) => {
      finalize(() => {
        finalized++
      })
      notifyEntered()
      await delay('infinite', { signal: request.signal })
      return HttpResponse.text('never')
    }))
    const abort = new AbortController()
    const pending = fetch(`${origin}/pending`, { signal: abort.signal })
    const rejected = assert.rejects(pending, { name: 'AbortError' })
    await entered
    abort.abort()
    await rejected
    await server.close()
    assert.equal(finalized, 1)
    assert.equal(globalThis.fetch, nativeFetch)
    assert.equal(await (await fetch(`${origin}/value`)).text(), 'real:')
  }
  finally {
    await server.close()
    backend.closeAllConnections()
    await new Promise((resolve, reject) => backend.close(error => error ? reject(error) : resolve()))
  }
}
