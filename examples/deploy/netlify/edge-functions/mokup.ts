import { http, HttpResponse } from 'mokup/http'
import { createFetchHandler } from 'mokup/server/fetch'

const handle = createFetchHandler({
  manifest: { version: 1, routes: [] },
  handlers: [http.get('/api/health', () => HttpResponse.json({ ok: true, runtime: 'netlify' }))],
  onNotFound: 'response',
})

export default async function mokup(request: Request) {
  return (await handle(request)) ?? new Response('Not Found', { status: 404 })
}

export const config = { path: '/api/*' }
