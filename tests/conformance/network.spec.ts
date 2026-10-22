import type { ViteDevServer } from 'vite'
import type { MockWebSocketConnection } from '../../packages/runtime/src/ws'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { createServer } from 'vite'
import { http, HttpResponse } from '../../packages/mokup/src/http'
import { attachPlaywright } from '../../packages/mokup/src/testing'

let server: ViteDevServer
let origin: string
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('./fixture', import.meta.url)),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { watch: null, hmr: false, host: '127.0.0.1', port: 0, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
    plugins: [{
      name: 'mokup-conformance-fixture',
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url === '/mockServiceWorker.js') {
            response.setHeader('Content-Type', 'text/javascript')
            response.end(await readFile(new URL('../../packages/mokup/dist/network/mockServiceWorker.mjs', import.meta.url)))
          }
          else if (request.url?.startsWith('/real')) {
            response.setHeader('Content-Type', 'text/plain')
            for await (const chunk of request) {
              response.write(chunk)
            }
            response.end(request.method === 'GET' ? 'real' : '')
          }
          else {
            next()
          }
        })
      },
    }],
  })
  await server.listen()
  origin = server.resolvedUrls!.local[0]!
})
test.afterAll(async () => {
  await server?.close()
})

test('standard handlers run in a Web Worker without Node or DOM dependencies', async ({ page }) => {
  await page.goto(origin)
  const result = await page.evaluate(async () => {
    const worker = new Worker('/worker.ts', { type: 'module' })
    try {
      return await new Promise((resolve, reject) => {
        worker.onmessage = event => resolve(event.data)
        worker.onerror = reject
        worker.postMessage('https://api.example.test/worker/edge')
      })
    }
    finally {
      worker.terminate()
    }
  })
  expect(result).toEqual({ id: 'edge' })
})

for (const mode of ['service-worker', 'interceptor'] as const) {
  test(`${mode}: MSW HTTP objects, exhausted sequences and callbacks migrate in the browser`, async ({ page }) => {
    await page.goto(origin)
    const result = await page.evaluate(async (mode) => {
      const entry = '/entry.ts'
      const { setupCompatibilityWorker, foreignHttp, ForeignResponse } = await import(entry)
      const worker = setupCompatibilityWorker(
        foreignHttp.get('/migration', function* () {
          yield ForeignResponse.text('first')
          return ForeignResponse.text('last')
        }),
        foreignHttp.get('/once-migration', function* () {
          yield ForeignResponse.text('first')
          yield ForeignResponse.text('last')
        }, { once: true }),
        foreignHttp.get('/once-migration', () => ForeignResponse.text('fallback')),
      )
      const unhandled: Array<{ protocol: string, id: string, body: string }> = []
      try {
        await worker.start({ mode, onUnhandledFrame: async ({ frame }: { frame: { protocol: string, data: { id: string, request: Request } } }) => {
          unhandled.push({ protocol: frame.protocol, id: frame.data.id, body: await frame.data.request.text() })
        } })
        const sequence: string[] = []
        const once: string[] = []
        for (let index = 0; index < 4; index++) {
          sequence.push(await (await fetch('/migration')).text())
          once.push(await (await fetch('/once-migration')).text())
        }
        worker.restoreHandlers()
        const restored = await (await fetch('/once-migration')).text()
        const body = await (await fetch('/real', { method: 'POST', body: 'original upload' })).text()
        return { sequence, once, restored, body, unhandled }
      }
      finally {
        await worker.stop()
      }
    }, mode)
    expect(result.sequence).toEqual(['first', 'last', 'last', 'last'])
    expect(result.once).toEqual(['first', 'last', 'last', 'fallback'])
    expect(result.restored).toBe('first')
    expect(result.body).toBe('original upload')
    expect(result.unhandled).toEqual([{ protocol: 'http', id: expect.any(String), body: 'original upload' }])
  })

  test(`${mode}: native file manifests preserve once, sequences and directory middleware`, async ({ page }) => {
    await page.goto(origin)
    const result = await page.evaluate(async (mode) => {
      const entry = '/entry.ts'
      const { setupWorker, compileManifestHandlers, defineHttpHandler, HttpResponse } = await import(entry)
      const middlewareSteps: string[] = []
      const middleware = async (c: { header: (key: string, value: string) => void }, next: () => Promise<void>) => {
        middlewareSteps.push('before')
        await next()
        middlewareSteps.push('after')
        c.header('x-directory', 'yes')
      }
      const definitions = await compileManifestHandlers({
        manifest: { version: 1, routes: [0, 1].map(index => ({
          method: 'POST',
          url: '/native/[id]',
          handlerType: 'http',
          ...(index === 0 ? { once: true } : {}),
          middleware: [{ module: 'native', exportName: 'middleware' }],
          response: { type: 'module', module: 'native', ruleIndex: index },
        })) },
        moduleMap: { native: { middleware, default: [
          defineHttpHandler(async ({ request, params }: { request: Request, params: { id: string } }) => HttpResponse.json({ mode: 'once', id: params.id, body: await request.text() })),
          defineHttpHandler(function* ({ params }: { params: { id: string } }) {
            yield HttpResponse.json({ mode: 'first', id: params.id })
            return HttpResponse.json({ mode: 'last', id: params.id })
          }),
        ] } },
      })
      const worker = setupWorker(...definitions)
      try {
        await worker.start({ mode, serviceWorker: { url: '/mockServiceWorker.js' } })
        const results = []
        for (let index = 0; index < 3; index++) {
          const response = await fetch('/native/42', { method: 'POST', body: 'original' })
          results.push({ status: response.status, header: response.headers.get('x-directory'), body: await response.json() })
        }
        worker.restoreHandlers()
        const restored = await (await fetch('/native/99', { method: 'POST', body: 'restored' })).json()
        return { results, restored, middlewareSteps }
      }
      finally {
        await worker.stop()
      }
    }, mode)
    expect(result.results).toEqual([
      { status: 200, header: 'yes', body: { mode: 'once', id: '42', body: 'original' } },
      { status: 200, header: 'yes', body: { mode: 'first', id: '42' } },
      { status: 200, header: 'yes', body: { mode: 'last', id: '42' } },
    ])
    expect(result.restored).toEqual({ mode: 'once', id: '99', body: 'restored' })
    expect(result.middlewareSteps).toEqual(Array.from({ length: 4 }, () => ['before', 'after']).flat())
  })
}

test('Playwright adapter preserves requests, session controls and unrelated routing', async ({ context, page }) => {
  const nativeRoute = async (route: import('@playwright/test').Route) => route.fulfill({ body: 'owned by test' })
  await context.route('**/owned', nativeRoute)
  const mocks = await attachPlaywright(context, { handlers: [
    http.post('/mock', async ({ request }) => HttpResponse.text(await request.text(), { status: 201 })),
  ] })
  try {
    await page.goto(origin)
    expect(await page.evaluate(async () => {
      const response = await fetch('/mock', { method: 'POST', body: 'echo' })
      return [response.status, await response.text()]
    })).toEqual([201, 'echo'])
    mocks.use(http.get('/real', () => HttpResponse.text('overridden')))
    expect(await page.evaluate(async () => (await fetch('/real')).text())).toBe('overridden')
    mocks.resetHandlers()
    expect(await page.evaluate(async () => (await fetch('/real')).text())).toBe('real')
  }
  finally {
    await mocks.detach()
  }
  expect(await page.evaluate(async () => (await fetch('/owned')).text())).toBe('owned by test')
  await context.unroute('**/owned', nativeRoute)
})

for (const mode of ['service-worker', 'interceptor'] as const) {
  test(`${mode}: Fetch, XHR, bodies, reset, streaming and teardown`, async ({ page }) => {
    const pageErrors: { name: string, message: string, stack: string | undefined }[] = []
    page.on('pageerror', error => pageErrors.push({ name: error.name, message: error.message, stack: error.stack }))
    await page.goto(origin)
    const result = await page.evaluate(async (mode) => {
      const entry = '/entry.ts'
      const { setupWorker, http, HttpResponse, passthrough, delay } = await import(entry)
      const events: string[] = []
      const worker = setupWorker(
        http.get('/users/:id', ({ params }: { params: { id: string } }) => HttpResponse.json({ id: params.id })),
        http.post('/echo', async ({ request }: { request: Request }) => new Response(await request.arrayBuffer(), { headers: { 'content-type': request.headers.get('content-type')! } })),
        http.get('/once', () => HttpResponse.text('once'), { once: true }),
        http.get('/once', () => HttpResponse.text('base')),
        http.get('/empty', () => new Response(null, { status: 204 })),
        http.get('/not-modified', () => new Response(null, { status: 304, headers: { etag: 'W/"mokup"' } })),
        http.head('/head', () => HttpResponse.text('must-be-empty')),
        http.get('/redirect', () => HttpResponse.redirect(new URL('/users/redirected', location.href).href)),
        http.post('/real', async ({ request }: { request: Request }) => {
          await request.text()
          return passthrough()
        }),
        http.get('/slow', async ({ request }: { request: Request }) => {
          await delay(10000, { signal: request.signal })
          return HttpResponse.text('late')
        }),
        http.get('/stream', () => new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode('first')) },
        }))),
      )
      worker.events.on('request:start', ({ requestId }: { requestId: string }) => events.push(requestId))
      await worker.start(mode === 'interceptor' ? { mode } : {})
      try {
        const user = await (await fetch('/users/42')).json()
        const concurrent = await Promise.all(['a', 'b', 'c'].map(async id => (await fetch(`/users/${id}`)).json()))
        const xhr = await new Promise<string>((resolve, reject) => {
          const request = new XMLHttpRequest()
          request.open('GET', '/users/xhr')
          request.onload = () => resolve(request.responseText)
          request.onerror = reject
          request.send()
        })
        const bytes = [...new Uint8Array(await (await fetch('/echo', { method: 'POST', body: new Uint8Array([0, 128, 255]) })).arrayBuffer())]
        const form = new FormData()
        form.set('name', 'Ada')
        const formResponse = await (await fetch('/echo', { method: 'POST', body: form })).formData()
        const once = [await (await fetch('/once')).text(), await (await fetch('/once')).text()]
        worker.restoreHandlers()
        once.push(await (await fetch('/once')).text())
        worker.use(http.get('/once', () => HttpResponse.text('override')))
        once.push(await (await fetch('/once')).text())
        worker.resetHandlers()
        once.push(await (await fetch('/once')).text())
        const empty = await fetch('/empty')
        const notModified = await fetch('/not-modified')
        const head = await fetch('/head', { method: 'HEAD' })
        const redirect = await (await fetch('/redirect')).json()
        const bypass = await (await fetch('/real', { method: 'POST', body: 'untouched' })).text()
        const abort = new AbortController()
        const slow = fetch('/slow', { signal: abort.signal }).then(() => false, () => true)
        setTimeout(() => abort.abort(), 20)
        const aborted = await slow
        const stream = (await fetch('/stream')).body!.getReader()
        const first = new TextDecoder().decode((await stream.read()).value)
        await stream.cancel()
        return { user, concurrent, xhr: JSON.parse(xhr), bytes, form: formResponse.get('name'), once, empty: [empty.status, await empty.text()], notModified: [notModified.status, notModified.headers.get('etag'), await notModified.text()], head: await head.text(), redirect, bypass, aborted, first, eventCount: events.length, uniqueIds: new Set(events).size }
      }
      finally {
        await worker.stop()
      }
    }, mode)
    expect(pageErrors).toEqual([])
    expect(result).toMatchObject({
      user: { id: '42' },
      concurrent: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      xhr: { id: 'xhr' },
      bytes: [0, 128, 255],
      form: 'Ada',
      once: ['once', 'base', 'once', 'override', 'once'],
      empty: [204, ''],
      notModified: [304, 'W/"mokup"', ''],
      head: '',
      redirect: { id: 'redirected' },
      bypass: 'untouched',
      aborted: true,
      first: 'first',
    })
    expect(result.eventCount).toBeGreaterThan(10)
    expect(result.uniqueIds).toBe(result.eventCount)
    expect(await page.evaluate(async () => (await fetch('/real')).text())).toBe('real')
  })

  test(`${mode}: intentional network errors reject fetch`, async ({ page, browserName }) => {
    const pageErrors: { name: string, message: string, stack: string | undefined }[] = []
    page.on('pageerror', error => pageErrors.push({ name: error.name, message: error.message, stack: error.stack }))
    await page.goto(origin)
    const rejected = await page.evaluate(async (mode) => {
      const entry = '/entry.ts'
      const { setupWorker, http, networkError } = await import(entry)
      const worker = setupWorker(http.get('/network-error', () => networkError()))
      await worker.start(mode === 'interceptor' ? { mode } : {})
      try {
        return await fetch('/network-error').then(() => false, () => true)
      }
      finally {
        await worker.stop()
      }
    }, mode)
    expect(rejected).toBe(true)
    if (browserName === 'webkit' && mode === 'service-worker') {
      // WebKit also reports this diagnostic for a plain native worker calling
      // event.respondWith(Response.error()), even when fetch rejection is caught.
      await expect.poll(() => pageErrors).toEqual([{
        name: '',
        message: 'Response served by service worker is an error',
        stack: '',
      }])
    }
    else {
      expect(pageErrors).toEqual([])
    }
  })
}

for (const mode of ['service-worker', 'interceptor'] as const) {
  test(`${mode}: EventSource consumes mocked SSE and closes cleanly`, async ({ page }) => {
    await page.goto(origin)
    const result = await page.evaluate(async (selectedMode) => {
      const entry = '/entry.ts'
      const { setupWorker, sse } = await import(entry)
      const worker = setupWorker(sse('/events', async function* () {
        yield { id: '1', data: { ok: true } }
        yield { event: 'update', data: 'done' }
      }))
      await worker.start(selectedMode === 'interceptor' ? { mode: selectedMode } : {})
      try {
        return await new Promise<string[]>((resolve, reject) => {
          const source = new EventSource('/events')
          const events: string[] = []
          const timeout = setTimeout(() => {
            source.close()
            reject(new Error('Timed out waiting for mocked EventSource events.'))
          }, 3000)
          const finish = () => {
            clearTimeout(timeout)
            source.close()
            resolve(events)
          }
          source.addEventListener('message', (event) => {
            const message = event as MessageEvent
            events.push(`${message.type}:${message.data}:${message.lastEventId}`)
          })
          source.addEventListener('update', (event) => {
            events.push(`${event.type}:${(event as Event & { data?: string }).data}`)
            finish()
          })
          source.onerror = () => {
            clearTimeout(timeout)
            source.close()
            reject(new Error('Mocked EventSource emitted an error.'))
          }
        })
      }
      finally {
        await worker.stop()
      }
    }, mode)
    expect(result).toEqual(['message:{"ok":true}:1', 'update:done'])
  })
}

test('WebSocket interceptor supports matched messages, broadcast, unhandled policy, and lifecycle teardown', async ({ page }) => {
  await page.goto(origin)
  const result = await page.evaluate(async () => {
    const entry = '/entry.ts'
    const { setupWebSocket, ws } = await import(entry)
    const lifecycle: string[] = []
    const link = ws.link('/chat')
    link.addEventListener('connection', ({ client }: MockWebSocketConnection) => {
      client.addEventListener('message', (event: MessageEvent) => {
        event.preventDefault()
        client.send(`echo:${String(event.data)}`)
      })
    })
    const controller = setupWebSocket(link)
    for (const type of ['protocol:start', 'protocol:match', 'protocol:message', 'protocol:unhandled', 'protocol:end'] as const) {
      controller.events.on(type, () => lifecycle.push(type))
    }
    controller.start({ onUnhandled: 'error' })
    const toWebSocketUrl = (path: string) => new URL(path, location.href).href.replace(/^http/u, 'ws')
    const matched = new WebSocket(toWebSocketUrl('/chat'))
    const matchedOpen = new Promise<void>((resolve, reject) => {
      matched.addEventListener('open', () => resolve(), { once: true })
      matched.addEventListener('error', () => reject(new Error('Matched WebSocket failed to open')), { once: true })
    })
    await matchedOpen
    const echoed = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for mocked WebSocket message.')), 3000)
      matched.addEventListener('message', (event) => {
        clearTimeout(timer)
        resolve(String(event.data))
      }, { once: true })
    })
    matched.send('hello')
    const echo = await echoed

    const second = new WebSocket(toWebSocketUrl('/chat'))
    await new Promise<void>((resolve, reject) => {
      second.addEventListener('open', () => resolve(), { once: true })
      second.addEventListener('error', () => reject(new Error('Second WebSocket failed to open')), { once: true })
    })
    const broadcast = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for broadcast.')), 3000)
      second.addEventListener('message', (event) => {
        clearTimeout(timer)
        resolve(String(event.data))
      }, { once: true })
    })
    link.broadcast('broadcast')
    const broadcastMessage = await broadcast

    const unhandled = new WebSocket(toWebSocketUrl('/missing'))
    const close = await new Promise<{ code: number, reason: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for unhandled WebSocket close.')), 3000)
      unhandled.addEventListener('close', (event) => {
        clearTimeout(timer)
        resolve({ code: event.code, reason: event.reason })
      }, { once: true })
      unhandled.addEventListener('error', () => undefined, { once: true })
    })

    matched.close()
    second.close()
    await controller.stop()
    return { echo, broadcastMessage, close, lifecycle, clients: link.clients.size }
  })
  expect(result.echo).toBe('echo:hello')
  expect(result.broadcastMessage).toBe('broadcast')
  expect(result.close.code).toBe(1008)
  expect(result.clients).toBe(0)
  expect(result.lifecycle).toEqual([
    'protocol:start',
    'protocol:match',
    'protocol:message',
    'protocol:start',
    'protocol:match',
    'protocol:start',
    'protocol:unhandled',
    'protocol:end',
    'protocol:end',
    'protocol:end',
  ])
})
