import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { startPreviewSwServer } from './utils/preview-sw-server'

type PreviewFixture = Awaited<ReturnType<typeof startPreviewSwServer>>

async function closeFixture(page: Page, fixture: PreviewFixture) {
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

async function readMock(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/workspace/api/value')
    return { status: response.status, body: await response.json() }
  })
}

async function openPlayground(page: Page, fixture: PreviewFixture) {
  const response = await page.goto(`${fixture.url}__mokup/`)
  const html = await response!.text()
  expect(html).not.toContain('/@id/')
  expect(html).not.toContain('/@vite/client')
  expect(html).not.toContain('mokup-playground-hmr')
  await expect(page.getByTestId('playground-app')).toBeVisible()
  return html
}

for (const runtime of ['node', 'worker'] as const) {
  test(`${runtime} dynamic preview registers its built worker after source routes are removed`, async ({ page }) => {
    const fixture = await startPreviewSwServer(runtime, true, {
      playground: true,
      removeSource: true,
      // No registration asset is emitted at build time; preview's current
      // automatic registration setting must still work with the built worker.
      buildRegister: false,
    })
    try {
      const html = await openPlayground(page, fixture)
      expect(html).toContain('id="mokup-playground-sw"')
      const routes = await (await fetch(`${fixture.url}__mokup/routes`)).json()
      expect(routes.count).toBe(0)
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${fixture.url}mokup-sw.js`)
      expect(await readMock(page)).toEqual({ status: 200, body: { source: 'build', revision: 1 } })
      const network = await fetch(`${fixture.url}api/value`)
      expect(network.status).toBe(207)
      expect(await network.json()).toEqual({ source: 'network' })
    }
    finally {
      await closeFixture(page, fixture)
    }
  })
}

test('dynamic preview preserves manual registration despite a built automatic lifecycle', async ({ page }) => {
  const fixture = await startPreviewSwServer('node', false, { playground: true, buildRegister: true })
  try {
    expect(await openPlayground(page, fixture)).not.toContain('id="mokup-playground-sw"')
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(list => list.length))).toBe(0)
    expect(await readMock(page)).toEqual({ status: 207, body: { source: 'network' } })
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/workspace/mokup-sw.js', { type: 'module', scope: '/workspace/' })
    })
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${fixture.url}mokup-sw.js`)
    expect(await readMock(page)).toEqual({ status: 200, body: { source: 'build', revision: 1 } })
  }
  finally {
    await closeFixture(page, fixture)
  }
})

test('dynamic preview does not register a missing worker even when source routes exist', async ({ page }) => {
  const fixture = await startPreviewSwServer('node', true, { playground: true, removeWorker: true })
  try {
    expect(await openPlayground(page, fixture)).not.toContain('id="mokup-playground-sw"')
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(list => list.length))).toBe(0)
    expect(await readMock(page)).toEqual({ status: 207, body: { source: 'network' } })
  }
  finally {
    await closeFixture(page, fixture)
  }
})

test('dynamic preview unregisters its worker without its artifact and preserves unrelated registrations', async ({ page }) => {
  const fixture = await startPreviewSwServer('node', true, { playground: true, unregister: true, removeSource: true })
  try {
    await page.goto(`${fixture.url}fixture-setup.html`)
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/workspace/mokup-sw.js', { type: 'module', scope: '/workspace/' })
      await navigator.serviceWorker.register('/workspace/unrelated-worker.js', { scope: '/workspace/unrelated/' })
    })
    await expect.poll(() => page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations()
      return registrations.filter(registration => registration.active?.state === 'activated').length
    })).toBe(2)
    await fixture.removeWorker()
    expect(await openPlayground(page, fixture)).toContain('id="mokup-playground-sw"')
    await expect.poll(() => page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations()
      return registrations.map(registration => registration.scope)
    })).toEqual([`${fixture.url}unrelated/`])
  }
  finally {
    await closeFixture(page, fixture)
  }
})
