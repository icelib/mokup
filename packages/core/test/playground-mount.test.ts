import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PreviewServer, ViteDevServer } from 'vite'
import { Buffer } from 'node:buffer'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPlaygroundMiddleware } from '../src/playground/middleware'

let distDir: string
beforeAll(async () => {
  distDir = await fs.mkdtemp(join(tmpdir(), 'mokup-core-mount-'))
  await fs.mkdir(join(distDir, 'assets'))
  await fs.writeFile(join(distDir, 'index.html'), '<html><head></head><body>playground</body></html>')
  await fs.writeFile(join(distDir, 'assets', 'app.js'), 'playground-asset')
})
afterAll(async () => {
  await fs.rm(distDir, { recursive: true, force: true })
})

async function request(url: string, path = '/__mokup', base = '/', options: {
  preview?: boolean
  getSwScript?: () => string | null
} = { getSwScript: () => 'globalThis.mokupWorker = true' }) {
  const server = options.preview
    ? { config: { base } } as PreviewServer
    : { config: { base }, ws: {} } as ViteDevServer
  const middleware = createPlaygroundMiddleware({
    config: { enabled: true, path, build: false },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getRoutes: () => [],
    getServer: () => server,
    ...(options.getSwScript ? { getSwScript: options.getSwScript } : {}),
    resolvePlaygroundDist: () => distDir,
  })
  const headers = new Map<string, string>()
  let body = ''
  const res = {
    statusCode: 200,
    setHeader: (name: string, value: string) => headers.set(name, value),
    end: (value?: string | Uint8Array) => { body = value ? Buffer.from(value).toString() : '' },
  }
  const next = vi.fn()
  await middleware({ url } as IncomingMessage, res as unknown as ServerResponse, next)
  return { body, headers, status: res.statusCode, next }
}

describe('playground mount boundaries', () => {
  it.each(['/', '/base/'])('passes neighboring application paths through with base %s', async (base) => {
    for (const mount of new Set(['/__mokup', `${base === '/' ? '' : '/base'}/__mokup`])) {
      for (const suffix of ['index.html', 'assets/app.js', '..admin', '-other', 'routes']) {
        const response = await request(`${mount}${suffix}`, '/__mokup', base)
        expect(response.next, `${mount}${suffix}`).toHaveBeenCalledExactlyOnceWith()
        expect(response.body).toBe('')
      }
    }
  })

  it.each(['/base/__mokup', '/__mokup'])('retains the valid mount and base alias %s', async (mount) => {
    const redirect = await request(`${mount}?keep=1`, '/__mokup', '/base/')
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('Location')).toBe(`${mount}/?keep=1`)
    const index = await request(`${mount}/index.html`, '/__mokup', '/base/')
    expect(index.body).toContain('mokup-playground-hmr')
    expect(index.next).not.toHaveBeenCalled()
    const routes = await request(`${mount}/routes`, '/__mokup', '/base/')
    expect(JSON.parse(routes.body)).toMatchObject({ basePath: mount, count: 0 })
    const asset = await request(`${mount}/assets/app.js`, '/__mokup', '/base/')
    expect(asset.body).toBe('playground-asset')
  })

  it.each([
    { base: '/', mount: '' },
    { base: '/base/', mount: '/base' },
    { base: '/base/', mount: '' },
  ])('serves a root playground at $base using mount "$mount"', async ({ base, mount }) => {
    for (const suffix of ['/', '/index.html']) {
      const index = await request(`${mount}${suffix}`, '/', base)
      expect(index.status).toBe(200)
      expect(index.headers.has('Location')).toBe(false)
      expect(index.body).toContain('mokup-playground-hmr')
      expect(index.body).toContain('mokup-playground-sw')
      expect(index.next).not.toHaveBeenCalled()
    }
    const routes = await request(`${mount}/routes`, '/', base)
    expect(JSON.parse(routes.body)).toMatchObject({ basePath: mount || '/', count: 0 })
    const asset = await request(`${mount}/assets/app.js`, '/', base)
    expect(asset.body).toBe('playground-asset')
  })

  it('adds the base when its name only prefixes a playground path segment', async () => {
    for (const mount of ['/base/baseball', '/baseball']) {
      const index = await request(`${mount}/`, '/baseball', '/base/')
      expect(index.body).toContain('playground')
      expect(index.next).not.toHaveBeenCalled()
      const routes = await request(`${mount}/routes`, '/baseball', '/base/')
      expect(JSON.parse(routes.body)).toMatchObject({ basePath: mount })
    }
  })

  it('does not duplicate a base already present as a complete path segment', async () => {
    const response = await request('/base/__mokup/routes', '/base/__mokup', '/base/')
    expect(JSON.parse(response.body)).toMatchObject({ basePath: '/base/__mokup' })
  })

  it('does not serve assets through symlinks outside the distribution directory', async () => {
    const outsideDir = await fs.mkdtemp(join(tmpdir(), 'mokup-core-outside-'))
    const linkedDir = join(distDir, 'assets', 'external')
    await fs.writeFile(join(outsideDir, 'secret.js'), 'outside-secret')
    try {
      await fs.symlink(outsideDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir')
    }
    catch (error) {
      await fs.rm(outsideDir, { recursive: true, force: true })
      if (process.platform === 'win32') {
        return
      }
      throw error
    }

    try {
      const response = await request('/__mokup/assets/external/secret.js')
      expect(response.next).toHaveBeenCalledExactlyOnceWith()
      expect(response.body).toBe('')
    }
    finally {
      await fs.rm(linkedDir, { recursive: true, force: true })
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})

describe('playground lifecycle injection', () => {
  it.each(['dev', 'preview'])('injects SW lifecycle scripts for %s HTML requests', async (kind) => {
    const getSwScript = vi.fn(() => 'globalThis.mokupWorker = true')
    for (const suffix of ['/', '/index.html']) {
      const response = await request(`/base/__mokup${suffix}`, '/__mokup', '/base/', {
        preview: kind === 'preview',
        getSwScript,
      })

      expect(response.status).toBe(200)
      expect(response.body).toContain('mokup-playground-sw')
      expect(response.body).toContain('globalThis.mokupWorker = true')
      expect(response.next).not.toHaveBeenCalled()
      if (kind === 'dev') {
        expect(response.body).toContain('mokup-playground-hmr')
        expect(response.body).toContain('/base/@vite/client')
      }
      else {
        expect(response.body).not.toContain('mokup-playground-hmr')
        expect(response.body).not.toContain('/@vite/client')
      }
    }
    expect(getSwScript).toHaveBeenCalledTimes(2)
  })

  it('omits SW injection when the lifecycle getter is absent', async () => {
    const response = await request('/__mokup/', '/__mokup', '/', { preview: true })

    expect(response.status).toBe(200)
    expect(response.body).not.toContain('mokup-playground-sw')
    expect(response.body).not.toContain('mokup-playground-hmr')
  })

  it('omits SW injection when the lifecycle getter returns null', async () => {
    const getSwScript = vi.fn(() => null)
    const response = await request('/__mokup/', '/__mokup', '/', { preview: true, getSwScript })

    expect(response.status).toBe(200)
    expect(response.body).not.toContain('mokup-playground-sw')
    expect(getSwScript).toHaveBeenCalledOnce()
  })

  it.each(['dev', 'preview'])('does not evaluate lifecycle scripts for %s non-HTML requests', async (kind) => {
    const getSwScript = vi.fn(() => 'globalThis.mokupWorker = true')
    for (const suffix of ['', '/routes', '/assets/app.js', '-other']) {
      const response = await request(`/base/__mokup${suffix}`, '/__mokup', '/base/', {
        preview: kind === 'preview',
        getSwScript,
      })
      expect(response.body).not.toContain('mokup-playground-sw')
    }
    expect(getSwScript).not.toHaveBeenCalled()
  })
})
