import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { startPreviewSwServer } from './utils/preview-sw-server'

async function readMock(page: Page, route: string) {
  return page.evaluate(async (url) => {
    const response = await fetch(url)
    return {
      status: response.status,
      body: await response.json(),
      middleware: response.headers.get('x-built-middleware'),
    }
  }, `/workspace/api/${route}`)
}

for (const playground of [false, true]) {
  test(`preview serves a base-prefixed worker for the ${playground ? 'dynamic Playground' : 'built application'}`, async ({ page }) => {
    const fixture = await startPreviewSwServer('node', true, {
      workerPath: '/workspace/mokup-sw.js',
      playground,
    })
    try {
      await expect(fixture.readOutput('workspace/mokup-sw.js')).rejects.toMatchObject({ code: 'ENOENT' })
      const workerUrl = `${fixture.url}mokup-sw.js`
      const response = await fetch(workerUrl)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toMatch(/javascript/)
      expect(await response.text()).toBe(fixture.worker)
      await page.goto(`${fixture.url}${playground ? '__mokup/' : ''}`)
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(workerUrl)
      expect(await readMock(page, 'value')).toEqual({
        status: 200,
        body: { source: 'build', revision: 1 },
        middleware: 'yes',
      })
      const network = await fetch(`${fixture.url}api/value`)
      expect(network.status).toBe(207)
      expect(await network.json()).toEqual({ source: 'network' })
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

for (const runtime of ['node', 'worker'] as const) {
  for (const register of [true, false]) {
    test(`${runtime} preview serves built SW routes with ${register ? 'automatic' : 'manual'} registration`, async ({ page }) => {
      const fixture = await startPreviewSwServer(runtime, register)
      try {
        const workerUrl = `${fixture.url}mokup-sw.js`
        const workerResponse = await fetch(workerUrl)
        expect(workerResponse.status).toBe(200)
        expect(await workerResponse.text()).toBe(fixture.worker)
        await page.goto(fixture.url)
        if (!register) {
          expect(await page.locator('script[src*="mokup-sw-lifecycle"]').count()).toBe(0)
          expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(list => list.length))).toBe(0)
          expect(await readMock(page, 'value')).toEqual({ status: 207, body: { source: 'network' }, middleware: null })
          await page.evaluate(async () => {
            await navigator.serviceWorker.register('/workspace/mokup-sw.js', { type: 'module', scope: '/workspace/' })
          })
        }
        await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(workerUrl)
        expect(await readMock(page, 'value')).toEqual({
          status: 200,
          body: { source: 'build', revision: 1 },
          middleware: 'yes',
        })
        expect(await readMock(page, 'typed?value=preview')).toEqual({
          status: 200,
          body: { source: 'typescript', query: 'preview' },
          middleware: 'yes',
        })
        // Server fallback is disabled; only the native browser SW can return mock data.
        const network = await fetch(`${fixture.url}api/value`)
        expect(network.status).toBe(207)
        expect(await network.json()).toEqual({ source: 'network' })
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
          await fixture.close()
        }
      }
    })
  }
}
