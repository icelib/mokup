import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { http, HttpResponse } from '@mokup/runtime/http'
import { createScenario, createScenarioCatalog } from '@mokup/runtime/scenario'
import { describe, expect, it, vi } from 'vitest'
import { createFetchServer } from '../src/fetch-server'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mokup-fetch-session-'))
  const mockDir = join(root, 'mock')
  await mkdir(mockDir)
  await writeFile(join(mockDir, 'version.get.json'), '{"version":1}')
  const server = await createFetchServer({ entries: { dir: mockDir, watch: false, log: false }, playground: false })
  return { root, mockDir, server }
}

describe('file server shared HTTP sessions', () => {
  it('keeps overrides and subscriptions across file refreshes and resets to the latest files', async () => {
    const { root, mockDir, server } = await fixture()
    const started = vi.fn()
    const matched = vi.fn()
    const session = server.mockSession
    session.events.on('request:start', started)
    session.events.on('request:match', matched)
    const override = http.get('/version', () => HttpResponse.text('once'), { once: true })
    session.use(override)
    try {
      expect(await (await server.fetch(new Request('http://localhost/version'))).text()).toBe('once')
      await writeFile(join(mockDir, 'version.get.json'), '{"version":2}')
      await server.refresh()
      expect(server.mockSession).toBe(session)
      expect(session.listHandlers()[0]).toBe(override)
      expect(await (await server.fetch(new Request('http://localhost/version'))).json()).toEqual({ version: 2 })
      session.restoreHandlers()
      expect(await (await server.fetch(new Request('http://localhost/version'))).text()).toBe('once')
      session.resetHandlers()
      expect(await (await server.fetch(new Request('http://localhost/version'))).json()).toEqual({ version: 2 })
      expect(started).toHaveBeenCalledTimes(4)
      expect(matched).toHaveBeenCalledTimes(4)
    }
    finally {
      await server.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts initial native handlers for routes absent from files and preserves their once state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-fetch-session-'))
    const handler = http.post('/extra', async ({ request }) => HttpResponse.json(await request.json()), { once: true })
    const server = await createFetchServer({ entries: { dir: root, watch: false, log: false }, playground: false, handlers: [handler] })
    try {
      const response = await server.fetch(new Request('http://localhost/extra', { method: 'POST', body: '{"native":true}' }))
      expect(await response.json()).toEqual({ native: true })
      await server.refresh()
      expect((await server.fetch(new Request('http://localhost/extra', { method: 'POST' }))).status).toBe(404)
      server.mockSession.resetHandlers()
      expect(await (await server.fetch(new Request('http://localhost/extra', { method: 'POST', body: '{"reset":true}' }))).json()).toEqual({ reset: true })
    }
    finally {
      await server.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('binds a scenario catalog to the server session for Playground controls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-fetch-session-'))
    const server = await createFetchServer({
      entries: { dir: root, watch: false, log: false },
      playground: false,
      scenario: createScenarioCatalog({
        happy: createScenario('happy', { status: 200 }),
        error: createScenario('error', { status: 500 }),
      }),
    })
    try {
      expect(server.mockSession.scenario?.active()).toBe('happy')
      server.mockSession.selectScenario('error')
      expect(server.mockSession.scenario?.active()).toBe('error')
      server.mockSession.resetScenario()
      expect(server.mockSession.scenario?.active()).toBe('happy')
    }
    finally {
      await server.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('disposes live streams, rejects later requests and refreshes, and closes idempotently', async () => {
    const { root, server } = await fixture()
    const cancelled = vi.fn()
    server.mockSession.use(http.get('/stream', () => new HttpResponse(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('live')) },
      cancel: cancelled,
    }))))
    try {
      const response = await server.fetch(new Request('http://localhost/stream'))
      const reader = response.body!.getReader()
      expect((await reader.read()).done).toBe(false)
      const first = server.dispose()
      expect(server.dispose()).toBe(first)
      await first
      expect(cancelled).toHaveBeenCalledOnce()
      await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
      await expect(server.fetch(new Request('http://localhost/version'))).rejects.toThrow('disposed')
      await expect(server.refresh()).rejects.toThrow('disposed')
      expect(() => server.mockSession.use(http.get('/later', () => HttpResponse.text('later')))).toThrow('disposed')
    }
    finally {
      await server.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
