import type { AddressInfo } from 'node:net'
import type { HttpHandler, UnhandledRequestPolicy } from '../../packages/mokup/src/http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { createServer } from 'vite'
import { http, HttpResponse, passthrough } from '../../packages/mokup/src/http'
import { createMokupPlugin as mokup } from '../../packages/mokup/src/vite/plugin'

function nativeSource(version: string) {
  return `
    import { defineHttpHandler, HttpResponse } from ${JSON.stringify(fileURLToPath(new URL('../../packages/runtime/dist/http.mjs', import.meta.url)))}
    export default [
      defineHttpHandler(() => HttpResponse.json({ version: '${version}-once' }), { once: true }),
      defineHttpHandler(function* () {
        yield HttpResponse.json({ version: '${version}-first' })
        return HttpResponse.json({ version: '${version}-last' })
      }),
    ]
  `
}

async function fixture(options: { empty?: boolean, native?: boolean, forward?: boolean, handlers?: readonly HttpHandler[], onUnhandled?: UnhandledRequestPolicy } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mokup-vite-session-e2e-'))
  const mockDir = join(root, 'mock')
  await mkdir(mockDir)
  const file = join(mockDir, options.native ? 'version.get.ts' : 'version.get.json')
  if (options.native) {
    await writeFile(file, nativeSource('initial'))
    await writeFile(join(mockDir, 'index.config.ts'), 'export default { middleware: async (c, next) => { await next(); c.header(\'x-directory\', \'yes\') } }')
  }
  else if (!options.empty) {
    await writeFile(join(mockDir, 'version.get.json'), '{"version":1}')
  }
  const plugin = mokup({
    entries: { dir: mockDir, log: false },
    playground: false,
    ...(options.handlers ? { handlers: options.handlers } : {}),
    ...(options.onUnhandled ? { onUnhandled: options.onUnhandled } : {}),
  })
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  try {
    server = await createServer({
      root,
      configFile: false,
      plugins: [plugin, ...(options.forward
        ? [{
            name: 'test:downstream',
            configureServer(server: Awaited<ReturnType<typeof createServer>>) {
              server.middlewares.use('/forward', (req, res) => req.pipe(res))
            },
          }]
        : [])],
      server: { host: '127.0.0.1', port: 0 },
      logLevel: 'silent',
    })
    await server.listen()
    const url = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}/version`
    const session = plugin.api.getMockSession()
    return {
      url,
      session,
      plugin,
      server,
      file,
      async close() {
        await server!.close()
        await rm(root, { recursive: true, force: true })
      },
    }
  }
  catch (error) {
    await server?.close()
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

test('Vite HTTP controls and events survive file refresh and reset to the latest route', async () => {
  const app = await fixture()
  const starts: string[] = []
  const ends: string[] = []
  app.session.events.on('request:start', event => starts.push(event.requestId))
  app.session.events.on('request:end', event => ends.push(event.requestId))
  let overrides = 0
  app.session.use(http.get('/version', () => {
    overrides++
    return HttpResponse.json({ version: 'override' })
  }, { once: true }))
  try {
    expect(await (await fetch(app.url)).json()).toEqual({ version: 'override' })
    expect(await (await fetch(app.url)).json()).toEqual({ version: 1 })
    await writeFile(app.file, '{"version":2}')
    await expect.poll(async () => (await (await fetch(app.url)).json()).version).toBe(2)
    expect(app.plugin.api.getMockSession()).toBe(app.session)
    expect(overrides).toBe(1)
    app.session.restoreHandlers()
    expect(await (await fetch(app.url)).json()).toEqual({ version: 'override' })
    app.session.resetHandlers()
    expect(await (await fetch(app.url)).json()).toEqual({ version: 2 })
    expect(ends).toEqual(starts)
  }
  finally {
    await app.close()
  }
})

test('Vite native file once and sequences retain middleware and restart after refresh', async () => {
  const app = await fixture({ native: true })
  try {
    for (const version of ['initial-once', 'initial-first', 'initial-last']) {
      const response = await fetch(app.url)
      expect(response.headers.get('x-directory')).toBe('yes')
      expect(await response.json()).toEqual({ version })
    }
    await writeFile(app.file, nativeSource('refreshed'))
    await expect.poll(async () => {
      const response = await fetch(app.url)
      return response.status === 200 ? (await response.json()).version : 'refreshing'
    }).toBe('refreshed-once')
    expect(app.plugin.api.getMockSession()).toBe(app.session)
    expect(await (await fetch(app.url)).json()).toEqual({ version: 'refreshed-first' })
    app.session.resetHandlers()
    expect(await (await fetch(app.url)).json()).toEqual({ version: 'refreshed-once' })
  }
  finally {
    await app.close()
  }
})

test('Vite serves initial and temporary native paths with an empty mock directory and reports misses', async () => {
  const misses: string[] = []
  const initial = http.get('/initial', () => HttpResponse.text('initial'))
  const app = await fixture({ empty: true, handlers: [initial], onUnhandled: (event) => {
    misses.push(event.url)
  } })
  const origin = new URL(app.url).origin
  try {
    expect(await (await fetch(`${origin}/initial`)).text()).toBe('initial')
    app.session.use(http.post(`${origin}/native/:id`, async ({ request, params }) => HttpResponse.json({ id: params['id'], data: await request.json() })))
    expect(await (await fetch(`${origin}/native/42`, { method: 'POST', body: '{"ok":true}' })).json()).toEqual({ id: '42', data: { ok: true } })
    expect((await fetch(`${origin}/missing`)).status).toBe(404)
    expect(misses).toEqual([`${origin}/missing`])
    app.session.resetHandlers()
    expect(app.session.listHandlers()).toEqual([initial])
    expect(await (await fetch(`${origin}/initial`)).text()).toBe('initial')
    app.session.setOnUnhandled('error')
    expect((await fetch(`${origin}/strict-miss`)).status).toBe(500)
    expect(await (await fetch(`${origin}/initial`)).text()).toBe('initial')
  }
  finally {
    await app.close()
  }
})

test('Vite forwards body bytes to downstream middleware after an explicit passthrough or miss', async () => {
  const app = await fixture({ forward: true })
  const origin = new URL(app.url).origin
  app.session.use(http.post('/forward', async ({ request }) => {
    expect(await request.text()).toBe('forwarded')
    return passthrough()
  }))
  try {
    expect(await (await fetch(`${origin}/forward`, { method: 'POST', body: 'forwarded' })).text()).toBe('forwarded')
    app.session.resetHandlers()
    expect(await (await fetch(`${origin}/forward`, { method: 'POST', body: 'unmatched' })).text()).toBe('unmatched')
    expect(await (await fetch(app.url)).json()).toEqual({ version: 1 })
  }
  finally {
    await app.close()
  }
})

test('closing Vite releases a live response stream and permanently closes its HTTP session', async () => {
  const app = await fixture()
  let cancellations = 0
  app.session.use(http.get('/version', () => new HttpResponse(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('live')) },
    cancel() { cancellations++ },
  }))))
  try {
    const response = await fetch(app.url)
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('live')
    await app.server.close()
    expect(cancellations).toBe(1)
    await expect(reader.read()).rejects.toBeInstanceOf(Error)
    expect(() => app.plugin.api.getMockSession()).toThrow('closed server')
    await expect(app.session.handle(new Request(app.url))).rejects.toThrow('disposed')
  }
  finally {
    await app.close()
  }
})
