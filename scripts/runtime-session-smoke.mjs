import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'

export async function smokeDeployedSessions() {
  const { http, HttpResponse, passthrough } = await import('mokup/http')
  const { createFetchHandler } = await import('@mokup/server/fetch')
  const { createConnectMiddleware, createMokupWorker: createNodeWorker } = await import('@mokup/server/node')
  const { createMokupWorker } = await import('@mokup/server/worker')
  const { createHonoMiddleware } = await import('@mokup/server/node')
  const { Hono } = await import('@mokup/shared/hono')
  const { defineHttpHandler } = await import('mokup')
  const nativeOptions = {
    manifest: { version: 1, routes: [0, 1].map(index => ({
      method: 'GET',
      url: '/native-file/[id]',
      handlerType: 'http',
      ...(index === 0 ? { once: true } : {}),
      middleware: [{ module: 'native', exportName: 'middleware' }],
      response: { type: 'module', module: 'native', ruleIndex: index },
    })) },
    moduleMap: { native: {
      middleware: async (c, next) => {
        await next()
        c.header('x-directory', 'yes')
      },
      default: [
        defineHttpHandler(({ params }) => HttpResponse.json({ id: params.id, mode: 'once' })),
        defineHttpHandler(function* ({ params }) {
          yield HttpResponse.json({ id: params.id, mode: 'first' })
          return HttpResponse.json({ id: params.id, mode: 'last' })
        }),
      ],
    } },
  }
  for (const createTransport of [(options) => {
    const handler = createFetchHandler(options)
    return { fetch: handler, close: handler.close }
  }, createMokupWorker]) {
    const transport = createTransport(nativeOptions)
    try {
      for (const mode of ['once', 'first', 'last']) {
        const response = await transport.fetch(new Request('https://example.test/native-file/42'))
        assert.equal(response.headers.get('x-directory'), 'yes')
        assert.deepEqual(await response.json(), { id: '42', mode })
      }
    }
    finally {
      await transport.close()
    }
  }
  const manifest = { version: 1, routes: [
    { method: 'GET', url: '/file', response: { type: 'text', body: 'file' } },
  ] }
  const handler = createFetchHandler({ manifest, handlers: [http.get('/initial', () => HttpResponse.text('native'))] })
  try {
    assert.equal(await (await handler(new Request('https://example.test/initial'))).text(), 'native')
    handler.use(http.get('/file', () => HttpResponse.text('once'), { once: true }))
    assert.equal(await (await handler(new Request('https://example.test/file'))).text(), 'once')
    assert.equal(await (await handler(new Request('https://example.test/file'))).text(), 'file')
    handler.restoreHandlers()
    assert.equal(await (await handler(new Request('https://example.test/file'))).text(), 'once')
    handler.resetHandlers()
    assert.equal((await handler.listHandlers()).length, 2)
    let entered = 0
    let release
    const gate = new Promise(resolve => release = resolve)
    handler.use(http.get('/concurrent', async ({ request }) => {
      if (++entered === 2) {
        release()
      }
      await gate
      return HttpResponse.text(new URL(request.url).searchParams.get('id'))
    }))
    const responses = await Promise.all(['one', 'two'].map(id => handler(new Request(`https://example.test/concurrent?id=${id}`, { signal: AbortSignal.timeout(5000) }))))
    assert.deepEqual(await Promise.all(responses.map(response => response.text())), ['one', 'two'])
  }
  finally {
    await handler.close()
  }
  assert.equal(handler.signal.aborted, true)

  const honoMiddleware = createHonoMiddleware({
    manifest: { version: 1, routes: [{ method: 'GET', url: '/users/[id]', response: { type: 'module', module: 'users' } }] },
    moduleMap: { users: { default: c => c.json({ params: c.req.param(), url: c.req.url }) } },
  })
  const child = new Hono().basePath('/api')
  child.use('*', honoMiddleware)
  const parent = new Hono().route('/teams/:tenant', child)
  try {
    const response = await parent.request('/teams/team/api/users/42?q=original')
    assert.deepEqual(await response.json(), { params: { tenant: 'team', id: '42' }, url: 'http://localhost/teams/team/api/users/42?q=original' })
    honoMiddleware.use(http.get('/extra', ({ request }) => HttpResponse.text(request.url), { once: true }))
    assert.equal(await (await parent.request('/teams/team/api/extra')).text(), 'http://localhost/teams/team/api/extra')
    assert.equal((await parent.request('/teams/team/api/extra')).status, 404)
    honoMiddleware.restoreHandlers()
    assert.equal((await parent.request('/teams/team/api/extra')).status, 200)
  }
  finally {
    await honoMiddleware.close()
  }

  const middleware = createConnectMiddleware({ manifest, handlers: [http.post('/native', async ({ request }) => {
    assert.equal(await request.text(), 'original')
    return passthrough()
  })] })
  const server = createServer((req, res) => {
    void middleware(req, res, (error) => {
      if (error) {
        res.statusCode = 500
        res.end(String(error))
      }
      else {
        req.pipe(res)
      }
    })
  })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const origin = `http://127.0.0.1:${server.address().port}`
    middleware.use(http.get(`${origin}/extra`, () => HttpResponse.text('native path')))
    assert.equal(await (await fetch(`${origin}/extra`)).text(), 'native path')
    assert.equal(await (await fetch(`${origin}/native`, { method: 'POST', body: 'original' })).text(), 'original')
    const events = []
    middleware.events.on('request:unhandled', event => events.push(event))
    await fetch(`${origin}/missing`)
    assert.equal(events.length, 1)
    middleware.setOnUnhandled('error')
    assert.equal((await fetch(`${origin}/missing`)).status, 500)
  }
  finally {
    await middleware.close()
    server.closeAllConnections()
    if (server.listening) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }

  for (const createWorker of [createMokupWorker, createNodeWorker]) {
    const worker = createWorker({
      manifest: { version: 1, routes: [{ method: 'GET', url: '/binding', response: { type: 'module', module: 'binding' } }] },
      moduleMap: { binding: { default: (c) => {
        c.executionCtx.waitUntil(Promise.resolve())
        return c.json(c.env)
      } } },
    })
    let calls = 0
    const context = { waitUntil() {
      calls++
    } }
    try {
      const response = await worker.fetch(new Request('https://example.test/binding'), { label: 'request binding' }, context)
      assert.deepEqual(await response.json(), { label: 'request binding' })
      assert.equal(calls, 1)
      worker.use(http.get('/extra', () => HttpResponse.text('native')))
      assert.equal(await (await worker.fetch(new Request('https://example.test/extra'))).text(), 'native')
      worker.resetHandlers()
      assert.equal((await worker.fetch(new Request('https://example.test/extra'))).status, 404)
    }
    finally {
      await worker.close()
    }
  }
}
