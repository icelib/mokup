import { http, HttpResponse } from 'npm:mokup/http'
import { createFetchHandler } from 'npm:mokup/server/fetch'

const handle = createFetchHandler({
  manifest: { version: 1, routes: [] },
  handlers: [http.get('/api/health', () => HttpResponse.json({ ok: true, runtime: 'deno' }))],
  onNotFound: 'response',
})

Deno.serve(request => handle(request).then(response => response ?? new Response('Not Found', { status: 404 })))
