import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from '@mokup/shared/hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerPlaygroundRoutes } from '../src/dev/playground/register'

const fixture = vi.hoisted(() => ({ distDir: '' }))
vi.mock('../src/dev/playground/assets', async (importOriginal) => {
  const assets = await importOriginal<typeof import('../src/dev/playground/assets')>()
  return { ...assets, resolvePlaygroundDist: () => fixture.distDir }
})

beforeAll(async () => {
  fixture.distDir = await fs.mkdtemp(join(tmpdir(), 'mokup-server-mount-'))
  await fs.mkdir(join(fixture.distDir, 'assets'))
  await fs.writeFile(join(fixture.distDir, 'index.html'), '<html>playground</html>')
  await fs.writeFile(join(fixture.distDir, 'assets', 'app.js'), 'playground-asset')
})
afterAll(async () => {
  await fs.rm(fixture.distDir, { recursive: true, force: true })
})

function createApp(path: string) {
  const app = new Hono()
  registerPlaygroundRoutes({
    app,
    routes: [],
    dirs: [],
    config: { enabled: true, path },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })
  app.get('*', c => c.text('application'))
  return app
}

describe('server playground mount boundaries', () => {
  it.each(['/__mokup', '/base/__mokup'])('preserves normal routes beneath %s', async (mount) => {
    const app = createApp(mount)
    const redirect = await app.request(mount)
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('Location')).toBe(`${mount}/`)
    for (const suffix of ['/', '/index.html']) {
      const index = await app.request(`${mount}${suffix}`)
      expect(await index.text()).toBe('<html>playground</html>')
    }
    const routes = await app.request(`${mount}/routes`)
    expect(await routes.json()).toMatchObject({ basePath: mount, count: 0 })
    const asset = await app.request(`${mount}/assets/app.js`)
    expect(await asset.text()).toBe('playground-asset')
  })

  it.each(['/__mokup', '/base/__mokup'])('leaves neighboring application paths alone at %s', async (mount) => {
    const app = createApp(mount)
    for (const suffix of ['index.html', 'assets/app.js', '..admin', '-other']) {
      const response = await app.request(`${mount}${suffix}`)
      expect(await response.text()).toBe('application')
    }
  })

  it('serves the index, routes and assets at a root mount without doubled slashes', async () => {
    const app = createApp('/')
    for (const path of ['/', '/index.html']) {
      const index = await app.request(path)
      expect(index.status).toBe(200)
      expect(index.headers.has('Location')).toBe(false)
      expect(await index.text()).toBe('<html>playground</html>')
    }
    const routes = await app.request('/routes')
    expect(await routes.json()).toMatchObject({ basePath: '/', count: 0 })
    const asset = await app.request('/assets/app.js')
    expect(await asset.text()).toBe('playground-asset')
  })

  it('passes unknown root resources to application routes', async () => {
    const response = await createApp('/').request('/api/ping')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('application')
  })

  it('keeps unknown resources under a non-root mount reserved for the playground', async () => {
    const response = await createApp('/__mokup').request('/__mokup/missing.js')
    expect(response.status).toBe(404)
  })
})
