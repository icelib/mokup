import process from 'node:process'
import { http, HttpResponse } from 'mokup/http'
import { createFetchHandler } from 'mokup/server/fetch'

const handle = createFetchHandler({
  manifest: { version: 1, routes: [] },
  handlers: [http.get('/api/health', () => HttpResponse.json({ ok: true, runtime: 'bun' }))],
  onNotFound: 'response',
})

Bun.serve({
  port: Number(process.env.PORT ?? 8787),
  fetch: request => handle(request).then(response => response ?? new Response('Not Found', { status: 404 })),
})
