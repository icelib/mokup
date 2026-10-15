import { expect, test } from '@playwright/test'
import { startPreviewPlaygroundServer } from './utils/preview-playground-server'

for (const playgroundPath of ['/inspect/mocks', '/workspace/inspect/mocks']) {
  test(`built Playground previews its snapshot at ${playgroundPath}`, async ({ page }) => {
    const fixture = await startPreviewPlaygroundServer(playgroundPath)
    const mount = `${fixture.url}inspect/mocks`
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    try {
      expect(fixture.misplacedFiles).toEqual([])
      const request = (url: string) => fetch(url, { signal: AbortSignal.timeout(10_000) })
      const redirect = await fetch(`${mount}?source=direct`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
      expect(redirect.status).toBe(302)
      expect(redirect.headers.get('location')).toBe('/workspace/inspect/mocks/?source=direct')
      expect(await (await request(`${mount}/`)).text()).toBe(fixture.html)
      expect(await (await request(`${mount}/routes`)).text()).toBe(fixture.routes)
      expect(await (await request(`${fixture.url}inspect/probe`)).json()).toEqual({ source: 'server-catch-all' })
      // Start directly at the Playground in this test's fresh browser context.
      const routesResponse = page.waitForResponse(`${mount}/routes`)
      await page.goto(`${mount}?source=direct`)
      expect(page.url()).toBe(`${mount}/?source=direct`)
      expect(await (await routesResponse).text()).toBe(fixture.routes)
      await expect(page.getByTestId('playground-app')).toBeVisible()
      await page.getByTestId('playground-search').fill('built-only')
      await expect(page.getByTestId('playground-tree-row').filter({ hasText: 'built-only' })).toHaveCount(1)
      await page.getByTestId('playground-search').fill('source-only')
      await expect(page.getByTestId('playground-tree-row')).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${fixture.url}mokup-sw.js`)
      expect(await page.evaluate(async () => {
        const response = await fetch('/workspace/api/value')
        return { status: response.status, body: await response.json() }
      })).toEqual({ status: 200, body: { source: 'build', revision: 1 } })
      // fallback:false and a separate HTTP sentinel prove that the browser SW
      // supplies the built mock, rather than live server middleware.
      const network = await request(`${fixture.url}api/value`)
      expect(network.status).toBe(207)
      expect(await network.json()).toEqual({ source: 'network' })
      expect(pageErrors).toEqual([])
    }
    finally {
      try {
        if (!page.isClosed() && page.url().startsWith(fixture.url)) {
          await page.evaluate(async () => {
            await Promise.all((await navigator.serviceWorker.getRegistrations()).map(registration => registration.unregister()))
          })
        }
      }
      finally {
        try {
          await page.close()
        }
        finally {
          await fixture.close()
        }
      }
    }
  })
}
