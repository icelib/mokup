import assert from 'node:assert/strict'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const bytes = [0, 255, 128, 65]
const label = '上传文件 ☃'

function createRequest(kind, origin = 'http://localhost') {
  const url = new URL(`/${kind}`, origin)
  const signal = AbortSignal.timeout(10_000)
  if (kind === 'binary') {
    return new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
      signal,
    })
  }
  const form = new FormData()
  form.set('label', label)
  form.set('file', new File([new Uint8Array(bytes)], 'payload.bin', { type: 'application/octet-stream' }))
  return new Request(url, { method: 'POST', body: form, signal })
}

async function checkRequests(send, adapter, origin) {
  for (const kind of ['binary', 'multipart']) {
    const response = await send(createRequest(kind, origin))
    assert.equal(response?.status, 200, `${adapter} ${kind} request status`)
    assert.deepEqual(await response.json(), kind === 'binary'
      ? { bytes }
      : { bytes, label, filename: 'payload.bin', contentType: 'application/octet-stream' }, `${adapter} ${kind} request bytes`)
  }
}

export async function smokeRequestBytes(directory, cli, run) {
  const fixture = await fs.mkdtemp(path.join(directory, 'request-bytes-'))
  const mockDir = path.join(fixture, 'mock')
  const outputDir = path.join(fixture, 'output')
  let server
  try {
    await fs.mkdir(mockDir)
    await fs.writeFile(path.join(mockDir, 'binary.post.ts'), [
      'export default async (c) => c.json({',
      '  bytes: Array.from(new Uint8Array(await c.req.arrayBuffer())),',
      '})',
      '',
    ].join('\n'))
    await fs.writeFile(path.join(mockDir, 'multipart.post.ts'), [
      'export default async (c) => {',
      '  const form = await c.req.formData()',
      '  const file = form.get("file")',
      '  return c.json({',
      '    bytes: Array.from(new Uint8Array(await file.arrayBuffer())),',
      '    label: form.get("label"),',
      '    filename: file.name,',
      '    contentType: file.type,',
      '  })',
      '}',
      '',
    ].join('\n'))
    await run(process.execPath, [cli, 'build', '--dir', mockDir, '--out', outputDir], directory)
    const { default: bundle } = await import(pathToFileURL(path.join(outputDir, 'mokup.bundle.mjs')).href)
    const { createFetchHandler } = await import('mokup/server/fetch')
    await checkRequests(createFetchHandler(bundle), 'Fetch')
    const { createMokupWorker } = await import('mokup/server/worker')
    await checkRequests(createMokupWorker(bundle).fetch, 'Worker')

    const { createConnectMiddleware } = await import('@mokup/server/connect')
    const middleware = createConnectMiddleware(bundle)
    server = createServer((req, res) => {
      void middleware(req, res, (error) => {
        res.statusCode = error ? 500 : 404
        res.end(error ? String(error) : 'Unmatched mock route')
      })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    await checkRequests(fetch, 'Connect HTTP', `http://127.0.0.1:${address.port}`)
  }
  finally {
    try {
      server?.closeAllConnections()
      if (server?.listening) {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      }
    }
    finally {
      await fs.rm(fixture, { recursive: true, force: true })
    }
  }
}
