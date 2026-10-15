import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

interface HttpResult {
  status: number
  headers: Record<string, string | string[]>
  body: string
}

function runHttpScenario(scenario: string): HttpResult[] {
  const source = `
    import { createServer, request } from 'node:http'
    import { createHonoApp, createMiddleware } from ${JSON.stringify(new URL('../src/middleware.ts', import.meta.url).href)}
    import { createPlaygroundMiddleware } from ${JSON.stringify(new URL('../src/playground/middleware.ts', import.meta.url).href)}
    const logger = { info() {}, warn() {}, error() {} }
    const route = (path, handler) => ({
      method: 'GET', template: path, file: 'mock/test.get.ts', score: [],
      tokens: [{ type: 'static', value: path.slice(1) }], handler,
    })
    async function withServer(middleware, run) {
      // Connect ignores async return values. Keep crashes in this child process.
      const server = createServer((req, res) => {
        void middleware(req, res, () => { res.statusCode = 404; res.end('next') })
      })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const read = path => new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: server.address().port, path }, res => {
          const chunks = []
          res.on('data', chunk => chunks.push(chunk))
          res.on('error', reject)
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
        })
        req.on('error', reject)
        req.setTimeout(1500, () => req.destroy(new Error('HTTP request timed out')))
        req.end()
      })
      try {
        console.log(JSON.stringify(await run(read)))
      }
      finally {
        const closing = new Promise(resolve => server.close(resolve))
        server.closeAllConnections()
        await closing
      }
    }
    ${scenario}
  `
  const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', '--input-type=module', '-e', source], {
    encoding: 'utf8',
    timeout: 15_000,
  })
  expect(result.error, result.stderr).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as HttpResult[]
}

describe('HTTP middleware request and response boundaries', () => {
  it.each(['mock', 'playground'])('keeps %s middleware available after malformed request targets', (kind) => {
    const path = kind === 'mock' ? '/ok' : '/__mokup/routes'
    const setup = kind === 'mock'
      ? `const app = createHonoApp([route('/ok', c => ({ query: c.req.query('value') ?? null }))]);
         const middleware = createMiddleware(() => app, logger)`
      : `const middleware = createPlaygroundMiddleware({ getRoutes: () => [], logger,
           config: { enabled: true, path: '/__mokup', build: false },
           resolvePlaygroundDist: () => '/not-read-by-routes-endpoint' })`
    const [normal, invalid, afterError, doubleSlash, absolute, secureAbsolute, protocolPath] = runHttpScenario(`
      ${setup}
      await withServer(middleware, async read => [
        await read(${JSON.stringify(`${path}?value=normal`)}),
        await read('http://['),
        await read(${JSON.stringify(path)}),
        await read(${JSON.stringify(`//[${path}`)}),
        await read(${JSON.stringify(`hTtP://mokup.local${path}?value=absolute`)}),
        await read(${JSON.stringify(`HTTPS://mokup.local${path}?value=secure`)}),
        await read('/ftp://path'),
      ])
    `)

    expect(normal?.status).toBe(200)
    expect(invalid).toMatchObject({ status: 400, body: 'Invalid request URL.' })
    expect(invalid?.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(afterError?.status).toBe(200)
    expect(doubleSlash).toMatchObject({ status: 404, body: 'next' })
    expect(absolute?.status).toBe(200)
    expect(secureAbsolute?.status).toBe(200)
    expect(protocolPath).toMatchObject({ status: 404, body: 'next' })
    if (kind === 'mock') {
      expect(JSON.parse(normal!.body)).toEqual({ query: 'normal' })
      expect(JSON.parse(absolute!.body)).toEqual({ query: 'absolute' })
      expect(JSON.parse(secureAbsolute!.body)).toEqual({ query: 'secure' })
    }
  }, 20_000)

  it.each(['mock', 'playground'])('rejects non-HTTP protocols before %s middleware handles a request', (kind) => {
    const path = kind === 'mock' ? '/ok' : '/__mokup/routes'
    const setup = kind === 'mock'
      ? `const app = createHonoApp([route('/ok', () => 'healthy')]);
         const middleware = createMiddleware(() => app, logger)`
      : `const middleware = createPlaygroundMiddleware({ getRoutes: () => [], logger,
           config: { enabled: true, path: '/__mokup', build: false },
           resolvePlaygroundDist: () => '/not-read-by-routes-endpoint' })`
    const targets = [`ftp://mokup.local${path}`, `ws://mokup.local${path}`, `wss://mokup.local${path}`, `file://${path}`]
    const results = runHttpScenario(`
      ${setup}
      await withServer(middleware, async read => {
        const results = []
        for (const target of ${JSON.stringify(targets)}) {
          results.push(await read(target), await read(${JSON.stringify(path)}))
        }
        return results
      })
    `)

    for (const [index, target] of targets.entries()) {
      expect(results[index * 2], target).toMatchObject({ status: 400, body: 'Invalid request URL.' })
      expect(results[index * 2]?.headers['content-type'], target).toBe('text/plain; charset=utf-8')
      expect(results[index * 2 + 1]?.status, `normal request after ${target}`).toBe(200)
    }
  }, 20_000)

  it.each(['body', 'header'])('does not commit response headers when its %s fails', (failure) => {
    const body = failure === 'body'
      ? `new ReadableStream({ start(controller) { controller.error(new Error('body failure')) } })`
      : `'valid body'`
    const [failed, recovered] = runHttpScenario(`
      const app = createHonoApp([
        route('/broken', () => new Response(${body}, { status: 201, headers: {
          'Content-Length': '1234', 'Content-Encoding': 'gzip',
          'Set-Cookie': 'session=failed; HttpOnly',
          'X-Bad': ${JSON.stringify(failure === 'header' ? String.fromCharCode(127) : 'valid')},
        } })),
        route('/ok', () => new Response('healthy', { headers: {
          'Content-Length': '7', 'X-Test': 'healthy', 'Set-Cookie': 'session=healthy; HttpOnly',
        } })),
      ])
      await withServer(createMiddleware(() => app, logger), async read => [
        await read('/broken'), await read('/ok'),
      ])
    `)

    expect(failed).toMatchObject({ status: 500, body: 'Mock handler error' })
    expect(failed?.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(failed?.headers['content-length']).not.toBe('1234')
    expect(failed?.headers['content-encoding']).toBeUndefined()
    expect(failed?.headers['set-cookie']).toBeUndefined()
    expect(recovered).toMatchObject({ status: 200, body: 'healthy' })
    expect(recovered?.headers).toMatchObject({
      'content-length': '7',
      'x-test': 'healthy',
      'set-cookie': ['session=healthy; HttpOnly'],
    })
  }, 20_000)
})
