import type { FSWatcher } from '@mokup/shared/chokidar'
import type { InlineConfig, PreviewServer, ViteDevServer } from 'vite'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import chokidar from '@mokup/shared/chokidar'
import { normalizePathForComparison } from '@mokup/shared/path-utils'
import { createServer, preview } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import mokup from '../src/vite'

function installFallback(server: ViteDevServer | PreviewServer) {
  return () => {
    server.middlewares.use((_request, response) => {
      response.statusCode = 404
      response.setHeader('x-application-fallback', 'yes')
      response.end('Application fallback')
    })
  }
}

async function readResponse(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
  return {
    status: response.status,
    body: await response.text(),
    fallback: response.headers.get('x-application-fallback'),
  }
}

describe.each(['dev', 'preview'] as const)('empty %s mock routes', (kind) => {
  it('serves the first route added after startup and follows deletion and recreation on the same server', async () => {
    // Match Vite's canonical paths, including /var -> /private/var on macOS.
    const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), `mokup-vite-empty-${kind}-`)))
    const mockDir = path.join(root, 'mock')
    const normalizedMockDir = normalizePathForComparison(mockDir)
    const routeFile = path.join(mockDir, 'ping.get.json')
    let server: ViteDevServer | PreviewServer | undefined
    // Observe the real preview watcher only to await its initial directory scan.
    // File changes below are delivered by the operating system, without emit().
    const watch = kind === 'preview' ? vi.spyOn(chokidar, 'watch') : undefined
    try {
      await fs.mkdir(mockDir)
      await fs.mkdir(path.join(root, 'dist'))
      await fs.writeFile(path.join(root, 'dist', 'index.html'), '<!doctype html><title>Fixture</title>')
      const config: InlineConfig = {
        root,
        base: '/workspace/',
        appType: 'custom',
        configFile: false,
        logLevel: 'silent',
        plugins: [
          mokup({ entries: { dir: 'mock', prefix: '/workspace/api', log: false }, playground: false }),
          { name: 'test:application-fallback', configureServer: installFallback, configurePreviewServer: installFallback },
        ],
        server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, ws: false },
        preview: { host: '127.0.0.1', port: 0, strictPort: true },
      }
      let watcher: Pick<FSWatcher, 'getWatched'> | undefined
      if (kind === 'dev') {
        const devServer = await createServer(config)
        server = devServer
        await devServer.listen()
        watcher = devServer.watcher
      }
      else {
        server = await preview(config)
        const watchIndex = watch?.mock.calls.findIndex(([dirs]) => (Array.isArray(dirs) ? dirs : [dirs])
          .some(dir => normalizePathForComparison(dir) === normalizedMockDir)) ?? -1
        const result = watch?.mock.results[watchIndex]
        if (result?.type === 'return') {
          watcher = result.value
        }
      }
      expect(watcher, 'the mock directory must have a real filesystem watcher').toBeDefined()
      // Vite, pathe and chokidar can use different separators and drive casing.
      await expect.poll(() => Object.keys(watcher?.getWatched() ?? {}).map(normalizePathForComparison), { timeout: 5000 })
        .toContain(normalizedMockDir)

      const address = server.httpServer?.address()
      if (!address || typeof address === 'string') {
        throw new Error('The Vite fixture did not open a TCP listener')
      }
      const url = `http://127.0.0.1:${address.port}/workspace/api/ping`
      const fallback = { status: 404, body: 'Application fallback', fallback: 'yes' }
      expect(await readResponse(url)).toEqual(fallback)

      await fs.writeFile(routeFile, JSON.stringify({ revision: 1 }))
      await expect.poll(() => readResponse(url), { timeout: 5000 }).toEqual({
        status: 200,
        body: JSON.stringify({ revision: 1 }),
        fallback: null,
      })

      await fs.unlink(routeFile)
      await expect.poll(() => readResponse(url), { timeout: 5000 }).toEqual(fallback)

      await fs.writeFile(routeFile, JSON.stringify({ revision: 2 }))
      await expect.poll(() => readResponse(url), { timeout: 5000 }).toEqual({
        status: 200,
        body: JSON.stringify({ revision: 2 }),
        fallback: null,
      })
    }
    finally {
      try {
        await server?.close()
      }
      finally {
        watch?.mockRestore()
        await fs.rm(root, { recursive: true, force: true })
      }
    }
  }, 20000)
})
