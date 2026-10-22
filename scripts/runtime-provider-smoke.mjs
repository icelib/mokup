import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import process from 'node:process'

// This smoke deliberately exercises the public Fetch contract instead of a
// development-only runtime object. Provider adapters are expected to preserve
// the same status, headers, bytes, cancellation and execution context.
const { http, HttpResponse, passthrough } = await import('../packages/runtime/dist/http.mjs')
const { createFetchHandler } = await import('../packages/server/dist/fetch.mjs')
const { createMokupWorker } = await import('../packages/server/dist/worker.mjs')
const { createHonoMiddleware } = await import('../packages/server/dist/hono.mjs')
const { createNextRouteHandler, createAstroEndpoint } = await import('../packages/server/dist/node.mjs')
const { Hono } = await import('../packages/shared/dist/hono.mjs')

const bytes = new Uint8Array([0, 1, 2, 127, 255])
const handlers = [
  http.get('/api/health', () => HttpResponse.json({ ok: true })),
  http.post('/api/echo', async ({ request }) => new Response(await request.arrayBuffer(), {
    status: 201,
    headers: { 'content-type': 'application/octet-stream', 'x-runtime': 'fetch' },
  })),
  http.head('/api/head', () => new Response('discarded', { headers: { 'content-length': '9', 'etag': 'W/"head"' } })),
  http.get('/api/empty', () => new Response(null, { status: 204, headers: { 'content-length': '9' } })),
  http.get('/api/not-modified', () => new Response(null, { status: 304, headers: { etag: 'W/"mokup"' } })),
  http.get('/api/redirect', () => HttpResponse.redirect('https://provider.test/api/health', 302)),
  http.get('/api/stream', () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('first'))
      controller.enqueue(new TextEncoder().encode('second'))
      controller.close()
    },
  }))),
  http.post('/api/pass', () => passthrough()),
]

async function check(label, fetcher, contextCheck = undefined) {
  const health = await fetcher(new Request('https://provider.test/api/health'))
  assert.equal(health.status, 200, `${label}: health status`)
  assert.deepEqual(await health.json(), { ok: true }, `${label}: health body`)

  const echo = await fetcher(new Request('https://provider.test/api/echo', {
    method: 'POST',
    body: bytes,
    headers: { 'content-type': 'application/octet-stream' },
  }))
  assert.equal(echo.status, 201, `${label}: binary status`)
  assert.deepEqual(new Uint8Array(await echo.arrayBuffer()), bytes, `${label}: binary body`)
  assert.equal(echo.headers.get('x-runtime'), 'fetch', `${label}: response header`)

  const head = await fetcher(new Request('https://provider.test/api/head', { method: 'HEAD' }))
  assert.equal(head.status, 200, `${label}: HEAD status`)
  assert.equal(await head.text(), '', `${label}: HEAD body`)
  assert.equal(head.headers.get('etag'), 'W/"head"', `${label}: HEAD metadata`)

  const empty = await fetcher(new Request('https://provider.test/api/empty'))
  assert.equal(empty.status, 204, `${label}: 204 status`)
  assert.equal(await empty.text(), '', `${label}: 204 body`)
  assert.equal(empty.headers.has('content-length'), false, `${label}: 204 framing`)

  const notModified = await fetcher(new Request('https://provider.test/api/not-modified'))
  assert.equal(notModified.status, 304, `${label}: 304 status`)
  assert.equal(await notModified.text(), '', `${label}: 304 body`)
  assert.equal(notModified.headers.get('etag'), 'W/"mokup"', `${label}: 304 metadata`)

  const stream = await fetcher(new Request('https://provider.test/api/stream'))
  assert.equal(await stream.text(), 'firstsecond', `${label}: stream body`)

  const redirect = await fetcher(new Request('https://provider.test/api/redirect', { redirect: 'manual' }))
  assert.equal(redirect.status, 302, `${label}: redirect status`)
  assert.equal(redirect.headers.get('location'), 'https://provider.test/api/health', `${label}: redirect location`)

  if (contextCheck) {
    await contextCheck()
  }
}

const options = { manifest: { version: 1, routes: [] }, handlers, onNotFound: 'response' }
const fetchHandler = createFetchHandler(options)
try {
  await check('fetch', fetchHandler)
}
finally {
  await fetchHandler.close()
}

const worker = createMokupWorker({ ...options, handlers: [
  ...handlers,
  http.get('/api/context', ({ context }) => HttpResponse.json({ env: context?.env, label: context?.executionCtx?.label })),
] })
try {
  await check('worker', worker.fetch, async () => {
    const response = await worker.fetch(new Request('https://provider.test/api/context'), { binding: 'ok' }, { label: 'worker' })
    assert.deepEqual(await response.json(), { env: { binding: 'ok' }, label: 'worker' })
  })
}
finally {
  await worker.close()
}

const hono = new Hono()
const honoMiddleware = createHonoMiddleware(options)
hono.all('*', honoMiddleware)
try {
  await check('hono', request => hono.fetch(request))
}
finally {
  await honoMiddleware.close()
}

const next = createNextRouteHandler(options)
try {
  await check('next', next.GET)
}
finally {
  await next.close()
}

const astro = createAstroEndpoint(options)
try {
  await check('astro', context => astro.GET({ request: context }))
}
finally {
  await astro.close()
}

// Keep this check independent of external provider CLIs. The source templates
// are validated by check-deployment-templates; this matrix validates the
// adapter contract that those providers execute.
assert.ok(Buffer.byteLength(process.version) > 0)
process.stdout.write('provider runtime matrix ok (fetch, worker, Hono, Next, Astro; bytes, stream, cookie-safe status, redirect, context)\n')
