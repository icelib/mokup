import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import process from 'node:process'
import { http, HttpResponse } from 'mokup/http'
import { createFetchHandler } from 'mokup/server/fetch'

const handle = createFetchHandler({
  manifest: { version: 1, routes: [] },
  handlers: [http.get('/api/health', () => HttpResponse.json({ ok: true, runtime: 'node' }))],
  onNotFound: 'response',
})

createServer(async (request, response) => {
  const url = `http://${request.headers.host ?? '127.0.0.1'}${request.url ?? '/'}`
  const result = await handle(new Request(url, { method: request.method, headers: request.headers }))
  response.statusCode = result?.status ?? 404
  result?.headers.forEach((value, name) => response.setHeader(name, value))
  response.end(result ? Buffer.from(await result.arrayBuffer()) : 'Not Found')
}).listen(Number(process.env.PORT ?? 8787), '127.0.0.1', () => {
  // eslint-disable-next-line no-console -- Template startup output is useful when copied into an app.
  console.log(`Mokup Node template listening on http://127.0.0.1:${process.env.PORT ?? 8787}`)
})
