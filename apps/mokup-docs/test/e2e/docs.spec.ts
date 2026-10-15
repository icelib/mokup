import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

async function retryOnNavigation<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  }
  catch (error) {
    if (error instanceof Error && error.message.includes('Execution context was destroyed, most likely because of a navigation.')) {
      return null
    }
    throw error
  }
}

test('docs home and quick start render', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'Mokup' })).toBeVisible()
  await page.getByRole('link', { name: 'Quick Start' }).click()
  await expect(page).toHaveURL(/getting-started\/quick-start/)

  await expect
    .poll(async () => {
      return retryOnNavigation(() => page.evaluate(async () => {
        try {
          const response = await fetch('/api/example-basic/ping')
          if (!response.ok) {
            return null
          }
          return response.json()
        }
        catch {
          return null
        }
      }))
    }, { timeout: 15_000 })
    .toMatchObject({ ok: true, example: 'basic' })
})

test('reloads ts mock response after file change', async ({ page }) => {
  const routeFile = join(process.cwd(), 'mock/example-auth/profile.get.ts')
  const original = await fs.readFile(routeFile, 'utf8')
  const marker = `e2e_${Date.now()}`
  const expected = {
    ok: true,
    user: {
      id: `user_${marker}`,
      name: `Demo ${marker}`,
      role: `member_${marker}`,
    },
  }

  const updated = [
    'import { defineHandler } from \'mokup\'',
    '',
    'export default defineHandler(() => {',
    '  return {',
    '    ok: true,',
    '    user: {',
    `      id: '${expected.user.id}',`,
    `      name: '${expected.user.name}',`,
    `      role: '${expected.user.role}',`,
    '    },',
    '  }',
    '})',
    '',
  ].join('\n')

  try {
    await page.goto('/__mokup/', { waitUntil: 'domcontentloaded' })

    await expect
      .poll(async () => {
        return retryOnNavigation(() => page.evaluate(async () => {
          try {
            const response = await fetch(`/api/example-auth/profile?warm=${Date.now()}`, {
              cache: 'no-store',
            })
            if (!response.ok) {
              return null
            }
            return response.json()
          }
          catch {
            return null
          }
        }))
      }, { timeout: 15_000 })
      .toMatchObject({ ok: true })

    await fs.writeFile(routeFile, updated, 'utf8')

    await expect
      .poll(async () => {
        return retryOnNavigation(() => page.evaluate(async () => {
          try {
            const response = await fetch(`/api/example-auth/profile?tick=${Date.now()}`, {
              cache: 'no-store',
            })
            if (!response.ok) {
              return null
            }
            return response.json()
          }
          catch {
            return null
          }
        }))
      }, { timeout: 20_000 })
      .toMatchObject(expected)
  }
  finally {
    await fs.writeFile(routeFile, original, 'utf8')
  }
})

test('reloads json mock response after file change in playground sw mode', async ({ page }) => {
  const routeFile = join(process.cwd(), 'mock/example-auth/session.get.json')
  const original = await fs.readFile(routeFile, 'utf8')
  const marker = Date.now()
  const nextExpiresIn = 333362200 + (marker % 1000)

  const updated = JSON.stringify({
    ok: true,
    session: {
      id: 'sess_demo',
      expiresIn: nextExpiresIn,
    },
  }, null, 2)

  try {
    await page.goto('/__mokup/', { waitUntil: 'domcontentloaded' })

    await expect
      .poll(async () => {
        return retryOnNavigation(() => page.evaluate(async () => {
          const controlled = !!navigator.serviceWorker?.controller
            && navigator.serviceWorker.controller.scriptURL.includes('mokup-sw')
          if (!controlled) {
            return false
          }
          try {
            const registrations = await navigator.serviceWorker.getRegistrations()
            return registrations.some((registration) => {
              const urls = [
                registration.active?.scriptURL,
                registration.waiting?.scriptURL,
                registration.installing?.scriptURL,
              ].filter((entry): entry is string => typeof entry === 'string')
              return urls.some(url => url.includes('mokup-sw'))
            })
          }
          catch {
            return false
          }
        }))
      }, { timeout: 20_000 })
      .toBe(true)

    await expect
      .poll(async () => {
        return retryOnNavigation(() => page.evaluate(async () => {
          try {
            const response = await fetch(`/api/example-auth/session?warm=${Date.now()}`, {
              cache: 'no-store',
              headers: {
                authorization: 'Bearer e2e-token',
              },
            })
            if (!response.ok) {
              return null
            }
            return await response.json()
          }
          catch {
            return null
          }
        }))
      }, { timeout: 15_000 })
      .toMatchObject({ ok: true, session: { id: 'sess_demo' } })

    await fs.writeFile(routeFile, `${updated}\n`, 'utf8')

    await expect
      .poll(async () => {
        return retryOnNavigation(() => page.evaluate(async () => {
          try {
            const response = await fetch(`/api/example-auth/session?tick=${Date.now()}`, {
              cache: 'no-store',
              headers: {
                authorization: 'Bearer e2e-token',
              },
            })
            if (!response.ok) {
              return null
            }
            return await response.json()
          }
          catch {
            return null
          }
        }))
      }, { timeout: 20_000 })
      .toMatchObject({
        ok: true,
        session: {
          id: 'sess_demo',
          expiresIn: nextExpiresIn,
        },
      })
  }
  finally {
    await fs.writeFile(routeFile, original, 'utf8')
  }
})
