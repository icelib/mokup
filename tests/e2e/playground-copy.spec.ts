import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { createPlaygroundMiddleware } from '../../packages/core/src/playground/middleware'
import { listen } from './utils/http'
import { repoRoot } from './utils/paths'

const execFileAsync = promisify(execFile)

async function copyRequest(page: Page, format: 'cURL' | 'fetch') {
  await page.locator('button[aria-controls="playground-copy-menu"]').click()
  await page.getByRole('menuitem', { name: `Copy ${format}`, exact: true }).click()
  return page.evaluate(() => document.documentElement.dataset['copiedRequest']!)
}

test('copied request snippets preserve the current origin, query, and raw body', async ({ page }) => {
  const middleware = createPlaygroundMiddleware({
    config: { enabled: true, path: '/__mokup', build: false },
    logger: console,
    getRoutes: () => [{
      file: `${repoRoot}/mock/echo.post.ts`,
      template: '/echo',
      method: 'POST',
      tokens: [{ type: 'static', value: 'echo' }],
      score: [4],
      handler: { ok: true },
    }],
  })
  const server = createServer((req, res) => {
    void middleware(req, res, async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk))
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ url: req.url, body: Buffer.concat(chunks).toString('utf8') }))
    }).catch(() => {
      res.statusCode = 500
      res.end()
    })
  })
  const { url, close } = await listen(server)
  try {
    await page.addInitScript(() => {
      localStorage.setItem('mokup.playground.locale', 'en-US')
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (text: string) => { document.documentElement.dataset['copiedRequest'] = text } },
        configurable: true,
      })
    })
    await page.goto(`${url}/__mokup/`)
    await expect(page.getByTestId('playground-app')).toBeVisible()
    await page.getByTestId('playground-tree-row').filter({ hasText: 'echo' }).click()
    const copyButton = page.locator('button[aria-controls="playground-copy-menu"]')
    await copyButton.focus()
    await copyButton.press('Enter')
    await expect(copyButton).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(copyButton).toHaveAttribute('aria-expanded', 'false')
    await expect(copyButton).toBeFocused()
    await page.getByPlaceholder('{ "q": "alpha", "page": 1 }').fill('{"first":"one","second":"two"}')
    await page.getByRole('tab', { name: 'Body none', exact: true }).click()
    await page.getByRole('radio', { name: 'raw', exact: true }).check()
    await page.getByRole('combobox').selectOption('text')
    const raw = '  @literal\nsecond \'quoted\' line  '
    await page.locator('.cm-content[contenteditable="true"]').fill(raw)
    await page.getByTestId('playground-run').click()
    await expect(page.getByTestId('playground-response')).toContainText('second=two')

    const fetchSnippet = await copyRequest(page, 'fetch')
    expect(fetchSnippet).toContain(url)
    expect(await page.evaluate(`(${fetchSnippet}).then(response => response.json())`)).toEqual({
      url: '/echo?first=one&second=two',
      body: raw,
    })
    const curlCommand = await copyRequest(page, 'cURL')
    expect(curlCommand).toContain(url)
    if (process.platform !== 'win32') {
      const { stdout } = await execFileAsync('/bin/sh', ['-c', curlCommand], { timeout: 10_000 })
      expect(JSON.parse(stdout)).toEqual({ url: '/echo?first=one&second=two', body: raw })
    }
  }
  finally {
    try {
      await page.close()
    }
    finally {
      server.closeAllConnections()
      await close()
    }
  }
})
