import type { Server } from 'node:http'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createFetchAdapter } from '../src/adapters/fetch'

async function withServer(run: (origin: string) => Promise<void>) {
  const server: Server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk))
      }
      const path = request.url ?? '/'
      const body = Buffer.concat(chunks)
      if (path.endsWith('/redirect307') || path.endsWith('/redirect308')) {
        response.statusCode = path.endsWith('/redirect307') ? 307 : 308
        response.setHeader('location', path.startsWith('/mock/') ? '/mock/target' : '/target')
        response.end()
        return
      }
      const contentType = request.headers['content-type'] ?? ''
      const payload: Record<string, unknown> = {
        path,
        method: request.method,
        contentType,
        body: body.toString(),
      }
      if (contentType.startsWith('multipart/form-data')) {
        const form = await new Response(body, { headers: { 'content-type': contentType } }).formData()
        const file = form.get('upload')
        payload['field'] = form.get('field')
        payload['file'] = file instanceof File
          ? { name: file.name, type: file.type, text: await file.text() }
          : null
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(payload))
    })().catch((error: unknown) => {
      response.statusCode = 500
      response.end(String(error))
    })
  })
  try {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('HTTP test server did not bind a port')
    }
    await run(`http://127.0.0.1:${address.port}`)
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
}

describe.each([false, true])('native fetch adapter with rewrite=%s', (rewrite) => {
  it.each([0, 307, 308])('sends a keepalive Request body through redirect %s', async (redirect) => {
    await withServer(async (origin) => {
      const adapter = createFetchAdapter({ resolverOptions: rewrite ? { realBase: `${origin}/mock` } : {} })
      const request = new Request(`${origin}/${redirect ? `redirect${redirect}` : 'target'}`, {
        method: 'POST',
        body: 'replayable payload',
        headers: { 'content-type': 'application/custom' },
        keepalive: true,
        signal: AbortSignal.timeout(2000),
      })
      const response = await adapter(request)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        path: rewrite ? '/mock/target' : '/target',
        method: 'POST',
        contentType: 'application/custom',
        body: 'replayable payload',
      })
    })
  })

  it('preserves FormData bytes and boundary, including a redirect after rewriting', async () => {
    await withServer(async (origin) => {
      const form = new FormData()
      form.set('field', '你好 world')
      form.set('upload', new File(['file contents'], 'report.txt', { type: 'text/plain' }))
      const input = new Request(`${origin}/${rewrite ? 'redirect307' : 'target'}`, {
        method: 'POST',
        body: form,
        keepalive: true,
        signal: AbortSignal.timeout(2000),
      })
      const contentType = input.headers.get('content-type')
      const adapter = createFetchAdapter({ resolverOptions: rewrite ? { realBase: `${origin}/mock` } : {} })
      const response = await adapter(input)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        contentType,
        field: '你好 world',
        file: { name: 'report.txt', type: 'text/plain', text: 'file contents' },
      })
    })
  })
})
