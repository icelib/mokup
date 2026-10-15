import { unlink } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { startEmptySwServer } from './utils/empty-sw-server'
import { writeJson } from './utils/fs'

for (const runtime of ['node', 'worker'] as const) {
  test(`${runtime} activates first SW routes and recovers after deleting every route`, async ({ page }) => {
    const fixture = await startEmptySwServer(runtime)
    try {
      await expect.poll(() => Object.keys(fixture.server.watcher.getWatched())).toContain(fixture.mockDir)
      const connected = page.waitForEvent('websocket').then(socket => socket.waitForEvent('framereceived', {
        predicate: frame => frame.payload.toString().includes('"type":"connected"'),
      }))
      await Promise.all([page.goto(fixture.url), connected])
      const read = () => page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration('/workspace/')
        // Let a pending worker activate without repeatedly dispatching requests to the old one.
        if (registration && (registration.installing || registration.waiting || registration.active?.state !== 'activated')) {
          return null
        }
        const response = await fetch('/workspace/api/value', { cache: 'no-store' })
        return { status: response.status, body: await response.json(), controlled: !!navigator.serviceWorker.controller }
      }).catch((error: unknown) => {
        if (error instanceof Error && error.message.includes('Execution context was destroyed') && !page.isClosed()) {
          return null
        }
        throw error
      })
      await expect.poll(read).toEqual({ status: 207, body: { source: 'network' }, controlled: false })
      expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(list => list.length))).toBe(0)

      for (const revision of [1, 2]) {
        await writeJson(fixture.routeFile, { source: 'mock', revision })
        // No test-driven page reload or manual registration: Vite must bootstrap it.
        await expect.poll(read, { intervals: [250, 500, 1000] }).toEqual({ status: 200, body: { source: 'mock', revision }, controlled: true })
        // The Node fallback is disabled, so a successful browser response proves SW interception.
        const network = await fetch(`${fixture.url}api/value`)
        expect(network.status).toBe(207)
        expect(await network.json()).toEqual({ source: 'network' })

        const documentHandle = await page.evaluateHandle(() => document)
        try {
          await unlink(fixture.routeFile)
          await expect.poll(read, { intervals: [250, 500, 1000] }).toEqual({ status: 207, body: { source: 'network' }, controlled: true })
          // Browser-only SW changes must keep the page and its update queue alive.
          expect(await documentHandle.evaluate(value => value === document)).toBe(true)
        }
        finally {
          await documentHandle.dispose()
        }
      }
    }
    catch (error) {
      const state = await page.evaluate(async () => ({
        registrations: (await navigator.serviceWorker.getRegistrations()).map(registration => ({
          active: registration.active?.state,
          installing: registration.installing?.state,
          waiting: registration.waiting?.state,
        })),
        response: await fetch('/workspace/api/value', { signal: AbortSignal.timeout(2000) })
          .then(async response => ({ status: response.status, body: await response.text() }))
          .catch(fetchError => ({ fetchError: String(fetchError) })),
      })).catch(diagnosticError => ({ diagnosticError: String(diagnosticError) }))
      await test.info().attach('worker-state', { body: JSON.stringify(state), contentType: 'application/json' })
      throw error
    }
    finally {
      try {
        if (!page.isClosed()) {
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

test('manual SW registration stays disabled when the first route is added', async ({ page }) => {
  const fixture = await startEmptySwServer('node', false)
  try {
    await expect.poll(() => Object.keys(fixture.server.watcher.getWatched())).toContain(fixture.mockDir)
    const socketReady = page.waitForEvent('websocket')
    await page.goto(fixture.url)
    const socket = await socketReady
    const updated = socket.waitForEvent('framereceived', {
      predicate: frame => frame.payload.toString().includes('mokup:routes-changed'),
    })
    await writeJson(fixture.routeFile, { source: 'mock', revision: 1 })
    await updated
    // Loading the updated HTML must also respect manual registration.
    await page.reload()
    expect(await page.locator('script[src*="mokup-sw-lifecycle"]').count()).toBe(0)
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(list => list.length))).toBe(0)
    const response = await page.evaluate(async () => {
      const result = await fetch('/workspace/api/value')
      return { status: result.status, body: await result.json() }
    })
    expect(response).toEqual({ status: 207, body: { source: 'network' } })
  }
  finally {
    await fixture.close()
  }
})
