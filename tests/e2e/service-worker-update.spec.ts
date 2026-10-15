import { expect, test } from '@playwright/test'
import { startSwUpdateServer } from './utils/sw-update-server'

interface HarnessWindow extends Window {
  __mokupTest: {
    emit: () => void | Promise<void>
    listening: () => boolean
    checks: () => number
    pendingUpdates: () => number
    activatedRevision: () => number
  }
}

for (const mode of ['playground', 'registration'] as const) {
  test(`${mode} retains updates while an older worker is installing`, async ({ page }, testInfo) => {
    const server = await startSwUpdateServer(mode)
    try {
      await page.goto(server.url)
      await expect.poll(() => page.evaluate(() => {
        return !!navigator.serviceWorker.controller
          && (window as unknown as HarnessWindow).__mokupTest.listening()
      })).toBe(true)
      const readRevision = () => page.evaluate(async () => {
        const response = await fetch('/value', { cache: 'no-store' })
        return (await response.json() as { revision: number }).revision
      })
      await expect.poll(readRevision).toBe(1)

      server.publish(2)
      await page.evaluate(() => (window as unknown as HarnessWindow).__mokupTest.emit())
      await expect.poll(server.isInstalling).toBe(true)
      await expect.poll(() => page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration()
        return {
          active: registration?.active?.state,
          installing: registration?.installing?.state,
        }
      })).toEqual({ active: 'activated', installing: 'installing' })

      // update() has already resolved, but the browser still owns the version 2 install job.
      // A new route event must survive until that job finishes and version 3 can be fetched.
      server.publish(3)
      const checks = await page.evaluate(async () => {
        const harness = (window as unknown as HarnessWindow).__mokupTest
        const before = harness.checks()
        await harness.emit()
        return before
      })
      if (mode === 'playground') {
        // The playground route listener starts its registration check without returning its promise.
        // Observe it in a later browser task before releasing the native install job.
        await expect.poll(() => page.evaluate(() => {
          return (window as unknown as HarnessWindow).__mokupTest.checks()
        })).toBeGreaterThan(checks)
      }
      await expect.poll(() => page.evaluate(() => {
        return (window as unknown as HarnessWindow).__mokupTest.pendingUpdates()
      })).toBe(0)
      expect(await readRevision()).toBe(1)
      server.release()
      // Repeated fetches can keep the old worker busy and prevent Chrome from activating its replacement.
      await expect.poll(() => page.evaluate(() => {
        return (window as unknown as HarnessWindow).__mokupTest.activatedRevision()
      })).toBe(3)
      expect(await readRevision()).toBe(3)
      expect(server.fetchedRevisions).toContain(3)
    }
    catch (error) {
      const state = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration()
        return {
          installing: registration?.installing?.state,
          waiting: registration?.waiting?.state,
          active: registration?.active?.state,
          controller: navigator.serviceWorker.controller?.state,
          revision: (window as unknown as HarnessWindow).__mokupTest.activatedRevision(),
        }
      }).catch(stateError => ({ diagnosticError: String(stateError) }))
      await testInfo.attach('service-worker-state', {
        contentType: 'application/json',
        body: JSON.stringify({ ...state, fetchedRevisions: server.fetchedRevisions }),
      })
      throw error
    }
    finally {
      server.release()
      try {
        if (!page.isClosed()) {
          await page.evaluate(async () => {
            const registrations = await navigator.serviceWorker.getRegistrations()
            await Promise.all(registrations.map(registration => registration.unregister()))
          })
        }
      }
      finally {
        await server.close()
      }
    }
  })
}
