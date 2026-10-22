import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Buffer } from 'node:buffer'
import { http, HttpResponse } from 'mokup/http'
import { createFetchHandler } from 'mokup/server/fetch'

const handle = createFetchHandler({
  manifest: { version: 1, routes: [] },
  handlers: [http.get('/api/health', () => HttpResponse.json({ ok: true, runtime: 'vercel' }))],
  onNotFound: 'response',
})

export default async function endpoint(request: VercelRequest, response: VercelResponse) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }
  }
  const result = await handle(new Request(`https://${request.headers.host ?? 'vercel.local'}${request.url ?? '/'}`, {
    method: request.method,
    headers,
  }))
  response.status(result?.status ?? 404)
  result?.headers.forEach((value, name) => response.setHeader(name, value))
  response.send(result ? Buffer.from(await result.arrayBuffer()) : 'Not Found')
}
