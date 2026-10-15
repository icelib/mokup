import type { PreviewServer } from 'vite'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createPlaygroundMiddleware } from '../../packages/core/src/playground/middleware'
import { createFetchServer, serve } from '../../packages/server/src/node'
import { listen } from './utils/http'
import { repoRoot } from './utils/paths'

for (const base of ['/', '/base/']) {
  test(`root playground loads its assets and routes with base ${base}`, async ({ page }) => {
    const middleware = createPlaygroundMiddleware({
      config: { enabled: true, path: '/', build: false },
      logger: console,
      getServer: () => ({ config: { base, root: repoRoot } }) as PreviewServer,
      getRoutes: () => [{
        file: `${repoRoot}/mock/ping.get.ts`,
        template: '/ping',
        method: 'GET',
        tokens: [{ type: 'static', value: 'ping' }],
        score: [4],
        handler: { ok: true },
      }],
    })
    const server = createServer((req, res) => {
      void middleware(req, res, () => {
        res.statusCode = 404
        res.end()
      }).catch(() => {
        res.statusCode = 500
        res.end()
      })
    })
    const { url, close } = await listen(server)
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    try {
      for (const suffix of ['', 'index.html']) {
        const routes = page.waitForResponse(`${url}${base}routes`)
        const response = await page.goto(`${url}${base}${suffix}`)
        expect(response?.status()).toBe(200)
        expect(page.url()).toBe(`${url}${base}${suffix}`)
        expect(await (await routes).json()).toMatchObject({ count: 1 })
        await expect(page.getByTestId('playground-app')).toBeVisible()
        await page.getByTestId('playground-search').fill('ping')
        await expect(page.getByTestId('playground-tree-row').filter({ hasText: 'ping' })).toHaveCount(1)
      }
      expect(pageErrors).toEqual([])
    }
    finally {
      server.closeAllConnections()
      await close()
    }
  })
}

test('root fetch playground can execute a listed mock route', async ({ page }) => {
  const mockDir = await mkdtemp(join(tmpdir(), 'mokup-playground-e2e-'))
  try {
    await writeFile(join(mockDir, 'ping.get.json'), '{"ok":"root-playground"}')
    const fetchServer = await createFetchServer({
      entries: { dir: mockDir, watch: false, log: false },
      playground: { path: '/' },
    })
    const server = serve({
      fetch: fetchServer.fetch,
      ...(fetchServer.websocket ? { websocket: fetchServer.websocket } : {}),
      hostname: '127.0.0.1',
      port: 0,
    })
    try {
      if (!server.listening) {
        await once(server, 'listening')
      }
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Expected a TCP server address')
      }
      await page.goto(`http://127.0.0.1:${address.port}/`)
      await expect(page.getByTestId('playground-app')).toBeVisible()
      await page.getByTestId('playground-search').fill('ping')
      await page.getByTestId('playground-tree-row').filter({ hasText: 'ping' }).click()
      await page.getByTestId('playground-run').click()
      await expect(page.getByTestId('playground-response')).toContainText('root-playground')
    }
    finally {
      try {
        await page.close()
      }
      finally {
        if ('closeAllConnections' in server) {
          server.closeAllConnections()
        }
        try {
          await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        }
        finally {
          await fetchServer.close?.()
        }
      }
    }
  }
  finally {
    await rm(mockDir, { recursive: true, force: true })
  }
})
