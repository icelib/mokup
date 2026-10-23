import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { stopProcess } from '../../tests/e2e/utils/process.mjs'
import { assertDocumentationArtifacts } from './artifacts.mjs'
import { docsTargets, resolveChannel } from './identity.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const appRoot = path.join(repoRoot, 'apps/mokup-docs')
const directory = path.join(appRoot, 'docs/.vitepress/dist')

async function getFreePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  assert.ok(address && typeof address !== 'string', 'Unable to reserve a local documentation port')
  return address.port
}

async function waitForServer(server, baseURL, identity, signal, getDiagnostics) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    const { error, logs } = getDiagnostics()
    if (error || server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Local Wrangler exited before becoming ready.\n${logs}`, { cause: error })
    }
    let response
    try {
      response = await fetch(`${baseURL}/docs-build.json`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
      })
    }
    catch {
      signal.throwIfAborted()
    }
    if (response?.ok) {
      assert.deepEqual(await response.json(), identity, 'Local server belongs to a different documentation build')
      return
    }
    await delay(200, undefined, { signal })
  }
  throw new Error(`Local Wrangler did not become ready within 30 seconds.\n${getDiagnostics().logs}`)
}

async function checkPages(page, context, baseURL, channel, screenshot, signal) {
  const preview = channel === 'preview'
  const origin = docsTargets[channel].url
  const robots = preview ? 'noindex, nofollow' : 'index, follow'
  const pages = [
    ['/', 'h1.heading', /^Mokup\s*File-driven HTTP framework$/u],
    ['/zh/', 'h1.heading', /^Mokup\s*面向项目全周期的文件式 HTTP 框架$/u],
    ['/getting-started/quick-start/', 'h1#quick-start', /^Quick Start[\s\u200B]*$/u],
    ['/zh/getting-started/quick-start/', 'h1#快速开始', /^快速开始[\s\u200B]*$/u],
  ]
  for (const [pathname, selector, heading] of pages) {
    signal.throwIfAborted()
    const response = await context.request.get(`${baseURL}${pathname}`)
    assert.equal(response.status(), 200, `HTTP status for ${pathname}`)
    assert.equal(response.headers()['x-robots-tag'], robots, `HTTP indexing policy for ${pathname}`)
    await page.goto(`${baseURL}${pathname}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator(selector)).toBeVisible()
    await expect(page.locator(selector)).toHaveText(heading)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${origin}${pathname}`)
    const banner = page.locator('.mokup-preview-banner')
    const noindex = page.locator('meta[name="robots"][content="noindex, nofollow"]')
    await expect(noindex).toHaveCount(preview ? 1 : 0)
    if (preview) {
      await expect(banner).toBeVisible()
      await expect(banner).toContainText(pathname.startsWith('/zh/') ? '未发布文档' : 'Unreleased documentation')
      await expect(banner.getByRole('link')).toHaveAttribute('href', `${docsTargets.stable.url}${pathname.startsWith('/zh/') ? '/zh/' : '/'}`)
    }
    else {
      await expect(banner).toHaveCount(0)
    }
    if (pathname === '/') {
      await page.screenshot({ path: screenshot })
    }
  }
  for (const filename of ['llms.txt', 'llms-full.txt', 'robots.txt', ...(!preview ? ['sitemap.xml'] : [])]) {
    signal.throwIfAborted()
    const response = await context.request.get(`${baseURL}/${filename}`)
    assert.equal(response.status(), 200, `HTTP status for ${filename}`)
    assert.equal(response.headers()['x-robots-tag'], robots, `HTTP indexing policy for ${filename}`)
    const content = await response.text()
    assert.ok(!content.trimStart().toLowerCase().startsWith('<!doctype html'), `${filename} must not fall back to HTML`)
    if (filename === 'robots.txt') {
      assert.ok(content.includes(preview ? 'Disallow: /' : `Sitemap: ${origin}/sitemap.xml`))
    }
    else {
      assert.ok(content.includes(`${origin}/`), `${filename} must use the ${channel} origin`)
    }
  }
  signal.throwIfAborted()
  await page.goto(`${baseURL}/__mokup/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => navigator.serviceWorker?.controller?.scriptURL.includes('mokup-sw'))
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/example-basic/ping', { signal: AbortSignal.timeout(10_000) })
    return { status: response.status, body: await response.json() }
  })
  assert.deepEqual(result, { status: 200, body: { ok: true, message: 'pong', example: 'basic' } })
}

async function main() {
  const identity = JSON.parse(await readFile(path.join(directory, 'docs-build.json'), 'utf8'))
  const channel = resolveChannel(identity.channel)
  await assertDocumentationArtifacts(directory, identity)
  const baseURL = `http://127.0.0.1:${await getFreePort()}`
  const screenshot = path.join(repoRoot, `.tmp/repoctl6-docs-${channel}.png`)
  await mkdir(path.dirname(screenshot), { recursive: true })
  const controller = new AbortController()
  const onSignal = signal => controller.abort(new Error(`Documentation browser smoke interrupted by ${signal}`))
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  let server
  let browser
  let context
  const errors = []
  const browserMessages = []
  let logs = ''
  let startupError
  try {
    server = spawn(process.execPath, [
      path.join(appRoot, 'node_modules/wrangler/bin/wrangler.js'),
      'dev',
      '--local',
      '--env',
      docsTargets[channel].environment,
      '--ip',
      '127.0.0.1',
      '--port',
      new URL(baseURL).port,
      '--inspector-port',
      '0',
      '--show-interactive-dev-session=false',
    ], {
      cwd: appRoot,
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_SEND_ERROR_REPORTS: 'false',
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
        CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const capture = chunk => logs = `${logs}${chunk}`.slice(-16_384)
    server.stdout.on('data', capture)
    server.stderr.on('data', capture)
    server.once('error', error => startupError = error)
    await waitForServer(server, baseURL, identity, controller.signal, () => ({ error: startupError, logs }))
    browser = await chromium.launch({ headless: true, channel: 'chrome' })
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    context.setDefaultTimeout(15_000)
    context.setDefaultNavigationTimeout(15_000)
    const page = await context.newPage()
    page.on('console', message => browserMessages.push(`${message.type()}: ${message.text()}`))
    page.on('pageerror', error => browserMessages.push(`pageerror: ${error.message}`))
    await checkPages(page, context, baseURL, channel, screenshot, controller.signal)
    controller.signal.throwIfAborted()
  }
  catch (error) {
    errors.push(error)
    console.error('Browser diagnostics:', browserMessages.slice(-20))
    const page = context?.pages()[0]
    if (page) {
      try {
        console.error('Page diagnostics:', await page.evaluate(async () => ({
          url: location.href,
          title: document.title,
          workers: (await navigator.serviceWorker.getRegistrations()).map(registration => ({
            scope: registration.scope,
            active: registration.active?.scriptURL,
            installing: registration.installing?.scriptURL,
          })),
        })))
        await page.screenshot({ path: screenshot.replace(/\.png$/u, '-failure.png') })
      }
      catch (diagnosticError) {
        errors.push(new Error('Unable to collect browser failure diagnostics', { cause: diagnosticError }))
      }
    }
  }
  finally {
    for (const [resource, close] of [
      ['browser context', () => context?.close()],
      ['browser', () => browser?.close()],
      ['local Wrangler', () => stopProcess(server)],
    ]) {
      try {
        await close()
      }
      catch (error) {
        errors.push(new Error(`Failed to clean up ${resource}`, { cause: error }))
      }
    }
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Documentation browser smoke failed')
  }
  console.log(`Documentation browser smoke passed: ${channel}; screenshot: ${screenshot}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
