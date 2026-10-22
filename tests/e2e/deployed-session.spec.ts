import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
import { http, HttpResponse, passthrough } from '../../packages/runtime/src/http'
import { createConnectMiddleware } from '../../packages/server/src/connect'
import { createHonoMiddleware } from '../../packages/server/src/hono'
import { createMokupWorker } from '../../packages/server/src/worker'
import { createMokupWorker as createNodeWorker } from '../../packages/server/src/worker-node'
import { Hono } from '../../packages/shared/src/hono'
import { listen } from './utils/http'

test('deployed Node middleware shares file and native controls with replayable POST fallthrough', async () => {
  const middleware = createConnectMiddleware({
    manifest: { version: 1, routes: [{ method: 'GET', url: '/file', response: { type: 'text', body: 'file' } }] },
    handlers: [http.post('/native', async ({ request }) => {
      expect(await request.text()).toBe('original')
      return passthrough()
    })],
  })
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
  const transport = await listen(server)
  try {
    middleware.use(http.get('/file', () => HttpResponse.text('override'), { once: true }))
    expect(await (await fetch(`${transport.url}/file`)).text()).toBe('override')
    expect(await (await fetch(`${transport.url}/file`)).text()).toBe('file')
    middleware.restoreHandlers()
    expect(await (await fetch(`${transport.url}/file`)).text()).toBe('override')
    middleware.resetHandlers()
    expect(await (await fetch(`${transport.url}/native`, { method: 'POST', body: 'original' })).text()).toBe('original')
    middleware.setOnUnhandled('error')
    expect((await fetch(`${transport.url}/missing`)).status).toBe(500)
  }
  finally {
    await middleware.close()
    await transport.close()
  }
})

test('deployed Hono and Worker adapters share native controls and request-scoped bindings', async () => {
  const options = { manifest: { version: 1 as const, routes: [] } }
  const middleware = createHonoMiddleware(options)
  const hono = new Hono()
  hono.use('*', middleware)
  const workers = [createMokupWorker(options), createNodeWorker(options)]
  const handler = http.get('/native', ({ context }) => HttpResponse.json((context as { env: unknown }).env))
  middleware.use(handler)
  workers.forEach(worker => worker.use(handler))
  try {
    expect(await (await hono.fetch(new Request('https://example.test/native'), { label: 'hono' })).json()).toEqual({ label: 'hono' })
    for (const worker of workers) {
      expect(await (await worker.fetch(new Request('https://example.test/native'), { label: 'worker' })).json()).toEqual({ label: 'worker' })
      worker.resetHandlers()
      expect((await worker.fetch(new Request('https://example.test/native'))).status).toBe(404)
    }
  }
  finally {
    await middleware.close()
    await Promise.all(workers.map(worker => worker.close()))
  }
})

test('mounted Hono scopes retain controls and original request metadata', async () => {
  const middleware = createHonoMiddleware({
    manifest: { version: 1, routes: [{ method: 'GET', url: '/users/[id]', response: { type: 'module', module: 'users' } }] },
    moduleMap: { users: { default: (c: import('../../packages/shared/src/hono').Context) => c.json({ params: c.req.param(), url: c.req.url }) } },
  })
  const child = new Hono().basePath('/api')
  child.use('*', middleware)
  const app = new Hono().route('/teams/:tenant', child)
  middleware.use(http.get('/extra', ({ request }) => HttpResponse.text(request.url), { once: true }))
  try {
    const response = await app.request('/teams/team/api/users/42?q=original')
    expect(await response.json()).toEqual({ params: { tenant: 'team', id: '42' }, url: 'http://localhost/teams/team/api/users/42?q=original' })
    expect(await (await app.request('/teams/team/api/extra')).text()).toBe('http://localhost/teams/team/api/extra')
    expect((await app.request('/teams/team/api/extra')).status).toBe(404)
    middleware.restoreHandlers()
    expect((await app.request('/teams/team/api/extra')).status).toBe(200)
  }
  finally {
    await middleware.close()
  }
})
