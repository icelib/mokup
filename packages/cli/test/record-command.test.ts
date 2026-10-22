import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRecordingProxy } from '../src/record-command'

describe('record proxy', () => {
  let directory: string | undefined
  let upstream: ReturnType<typeof createServer> | undefined
  let proxy: ReturnType<typeof createRecordingProxy> | undefined

  afterEach(async () => {
    await proxy?.close()
    if (upstream?.listening) {
      await new Promise<void>((resolve, reject) => upstream!.close(error => error ? reject(error) : resolve()))
    }
    if (directory) {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('forwards requests and retains redacted fixtures', async () => {
    upstream = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk))
      }
      response.setHeader('content-type', 'application/json')
      response.setHeader('set-cookie', ['session=secret; HttpOnly'])
      response.end(JSON.stringify({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString() }))
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const upstreamAddress = upstream.address() as { port: number }
    directory = await mkdtemp(join(tmpdir(), 'mokup-record-'))
    proxy = createRecordingProxy({ target: `http://127.0.0.1:${upstreamAddress.port}`, out: join(directory, 'fixtures.json'), redactQuery: ['token'] })
    proxy.server.listen(0, '127.0.0.1')
    await once(proxy.server, 'listening')
    const proxyAddress = proxy.server.address() as { port: number }

    const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/users?token=secret`, {
      method: 'POST',
      headers: { 'authorization': 'Bearer secret', 'content-type': 'text/plain' },
      body: 'Ada',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ method: 'POST', url: '/users?token=secret', body: 'Ada' })
    await proxy.close()
    const [fixture] = proxy.recorder.fixtures()
    expect(fixture?.request.url).toContain('token=%5BREDACTED%5D')
    expect(fixture?.request.headers).toContainEqual(['authorization', '[REDACTED]'])
    expect(fixture?.response.headers).toContainEqual(['set-cookie', '[REDACTED]'])
  })

  it('forwards response streams before the upstream finishes', async () => {
    let release: () => void = () => {}
    let upstreamFinished = false
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    upstream = createServer(async (_request, response) => {
      response.setHeader('content-type', 'text/plain')
      response.flushHeaders()
      response.write('first')
      await released
      response.end('second')
      upstreamFinished = true
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const upstreamAddress = upstream.address() as { port: number }
    directory = await mkdtemp(join(tmpdir(), 'mokup-record-stream-'))
    proxy = createRecordingProxy({ target: `http://127.0.0.1:${upstreamAddress.port}`, out: join(directory, 'fixtures.json') })
    proxy.server.listen(0, '127.0.0.1')
    await once(proxy.server, 'listening')
    const proxyAddress = proxy.server.address() as { port: number }

    const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/stream`)
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('first')
    expect(upstreamFinished).toBe(false)
    release()
    const chunks = [new TextDecoder().decode(first.value)]
    while (true) {
      const next = await reader.read()
      if (next.done) {
        break
      }
      chunks.push(new TextDecoder().decode(next.value))
    }
    expect(chunks.join('')).toBe('firstsecond')
    await proxy.recorder.flush()
    expect(proxy.recorder.fixtures()).toHaveLength(1)
  })
})
