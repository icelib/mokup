import type { ViteDevServer } from 'vite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { createServer } from 'vite'

let server: ViteDevServer
let origin: string
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('./fixture', import.meta.url)),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { watch: null, hmr: false, host: '127.0.0.1', port: 0, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
    plugins: [{
      name: 'mokup-cookie-fixture',
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url === '/mockServiceWorker.js') {
            response.setHeader('Content-Type', 'text/javascript')
            response.end(await readFile(new URL('../../packages/mokup/dist/network/mockServiceWorker.mjs', import.meta.url)))
          }
          else if (request.url === '/real-cookies') {
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ cookie: request.headers.cookie ?? '' }))
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

for (const mode of ['service-worker', 'interceptor'] as const) {
  test(`${mode}: browser cookies stay scoped to the mock owner and request credentials`, async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto(origin)
    const result = await page.evaluate(async (mode) => {
      const entry = '/entry.ts'
      const { setupWorker, http, HttpResponse } = await import(entry)
      document.cookie = 'visible_cookie=present; Path=/; SameSite=Lax'
      const read = ({ request, cookies }: { request: Request, cookies: unknown }) => HttpResponse.json({ cookies, header: request.headers.get('cookie') })
      const reader = http.get(/\/(?:auth|other)\/read$/, read)
      const worker = setupWorker(
        reader,
        http.get('/auth/set', () => HttpResponse.text('set', { headers: [
          ['set-cookie', 'virtual_token=secret; Path=/auth; HttpOnly; SameSite=Lax'],
          ['set-cookie', 'root_token=root; Path=/; SameSite=Lax'],
        ] })),
        http.get('/auth/omit', () => HttpResponse.text('omitted', { headers: { 'set-cookie': 'omitted_cookie=ignored; Path=/' } })),
        http.get('https://api.other.test/set', () => HttpResponse.text('cross', { headers: [
          ['set-cookie', 'cross_cookie=allowed; Path=/; Secure; SameSite=None'],
          ['set-cookie', 'strict_cookie=blocked; Path=/; Secure; SameSite=Strict'],
          ['set-cookie', 'default_cookie=blocked; Path=/; Secure'],
        ] })),
        http.get('https://api.other.test/read', read),
      )
      const options = mode === 'interceptor' ? { mode } : {}
      await worker.start(options)
      try {
        const before = await (await fetch('/auth/read')).json()
        await (await fetch('/auth/set')).text()
        await (await fetch('/auth/omit', { credentials: 'omit' })).text()
        const after = await (await fetch('/auth/read')).json()
        const otherPath = await (await fetch('/other/read')).json()
        const omitted = await (await fetch('/auth/read', { credentials: 'omit' })).json()
        const actual = await (await fetch('/real-cookies')).json()
        await (await fetch('https://api.other.test/set', { credentials: 'include' })).text()
        const cross = await (await fetch('https://api.other.test/read', { credentials: 'include' })).json()
        const crossDefault = await (await fetch('https://api.other.test/read')).json()
        const second = setupWorker(reader)
        await second.start(options)
        let isolated: unknown
        try {
          isolated = await (await fetch('/auth/read')).json()
        }
        finally {
          await second.stop()
        }
        const restored = await (await fetch('/auth/read')).json()
        await worker.stop()
        await worker.start(options)
        const restarted = await (await fetch('/auth/read')).json()
        return { before, after, otherPath, omitted, actual, cross, crossDefault, isolated, restored, restarted, documentCookie: document.cookie }
      }
      finally {
        await worker.stop()
      }
    }, mode)
    expect(pageErrors).toEqual([])
    expect(result.before).toEqual({ cookies: { visible_cookie: 'present' }, header: null })
    expect(result.after).toEqual({ cookies: { visible_cookie: 'present', virtual_token: 'secret', root_token: 'root' }, header: null })
    expect(result.otherPath.cookies).toEqual({ visible_cookie: 'present', root_token: 'root' })
    expect(result.omitted.cookies).toEqual({})
    expect(result.actual.cookie).toBe('visible_cookie=present')
    expect(result.cross.cookies).toEqual({ cross_cookie: 'allowed' })
    expect(result.crossDefault.cookies).toEqual({})
    expect(result.isolated).toEqual(result.before)
    expect(result.restored).toEqual(result.after)
    expect(result.restarted).toEqual(result.before)
    expect(result.documentCookie).toBe('visible_cookie=present')
  })
}
