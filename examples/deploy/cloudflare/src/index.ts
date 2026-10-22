import { http, HttpResponse } from 'mokup/http'
import { createMokupWorker } from 'mokup/server/worker'

const worker = createMokupWorker({
  manifest: { version: 1, routes: [] },
  handlers: [http.get('/api/health', () => HttpResponse.json({ ok: true, runtime: 'cloudflare' }))],
})

export default worker
