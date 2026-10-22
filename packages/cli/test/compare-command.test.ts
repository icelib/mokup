import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCompare } from '../src/compare-command'

describe('live comparison CLI command', () => {
  let directory: string | undefined
  let upstream: ReturnType<typeof createServer> | undefined

  afterEach(async () => {
    if (upstream?.listening) {
      await new Promise<void>((resolve, reject) => upstream!.close(error => error ? reject(error) : resolve()))
    }
    if (directory) {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('runs a mock and real request with independent bodies and redacted report data', async () => {
    directory = await mkdtemp(join(tmpdir(), 'mokup-compare-'))
    const mock = join(directory, 'mock')
    await mkdir(mock, { recursive: true })
    await writeFile(join(directory, 'request.json'), JSON.stringify({
      method: 'GET',
      url: 'https://mock.test/users?token=secret',
      headers: { authorization: 'Bearer secret' },
    }))
    await writeFile(join(mock, 'users.get.json'), JSON.stringify({ ok: true }))
    upstream = createServer((request, response) => {
      expect(request.url).toBe('/users?token=secret')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true }))
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const port = (upstream.address() as { port: number }).port

    const result = await runCompare({
      request: join(directory, 'request.json'),
      real: `http://127.0.0.1:${port}`,
      root: directory,
      dir: ['mock'],
      redactQuery: ['token'],
    })
    expect(result.equal).toBe(true)
    expect(result.request.url).toBe('https://mock.test/users?token=%5BREDACTED%5D')
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(result.mock.fixture?.response.status).toBe(200)
    expect(result.real.fixture?.response.status).toBe(200)
  })

  it('reports response differences without exposing upstream secrets', async () => {
    directory = await mkdtemp(join(tmpdir(), 'mokup-compare-diff-'))
    const mock = join(directory, 'mock')
    await mkdir(mock, { recursive: true })
    await writeFile(join(directory, 'request.json'), JSON.stringify({ url: 'https://mock.test/value' }))
    await writeFile(join(mock, 'value.get.json'), JSON.stringify({ source: 'mock' }))
    upstream = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ source: 'real', token: 'upstream-secret' }))
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    const port = (upstream.address() as { port: number }).port

    const result = await runCompare({
      request: join(directory, 'request.json'),
      real: `http://127.0.0.1:${port}/value`,
      root: directory,
      dir: ['mock'],
      redactJsonPointer: ['/token'],
    })
    expect(result.equal).toBe(false)
    expect(result.diff?.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/response/body/value/source', kind: 'changed' }),
      expect.objectContaining({ path: '/response/body/value/token', kind: 'added' }),
    ]))
    expect(JSON.stringify(result)).not.toContain('upstream-secret')
  })
})
