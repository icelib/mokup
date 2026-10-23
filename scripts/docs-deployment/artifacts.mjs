import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { assertBuildIdentity, docsTargets, resolveChannel } from './identity.mjs'

export async function assertDocumentationArtifacts(directory, identity) {
  const read = filename => readFile(path.join(directory, filename), 'utf8')
  const actual = JSON.parse(await read('docs-build.json'))
  assertBuildIdentity(actual, identity)
  const channel = resolveChannel(identity.channel)
  const origin = docsTargets[channel].url
  const preview = channel === 'preview'
  for (const filename of ['index.html', 'zh/index.html', 'getting-started/quick-start/index.html']) {
    const html = await read(filename)
    assert.ok(html.includes(`<link rel="canonical" href="${origin}/`), `Wrong canonical URL in ${filename}`)
    assert.ok(html.includes(`<meta property="og:image" content="${origin}/brand/mokup-logo.svg"`), `Wrong social image in ${filename}`)
    assert.equal(html.includes('name="robots" content="noindex, nofollow"'), preview, `Wrong indexing policy in ${filename}`)
    assert.equal(html.includes('class="mokup-preview-banner"'), preview, `Wrong preview notice in ${filename}`)
  }
  const robots = await read('robots.txt')
  const headers = await read('_headers')
  assert.equal(robots.includes('Disallow: /'), preview, 'Wrong robots.txt indexing policy')
  assert.equal(headers.includes('X-Robots-Tag: noindex, nofollow'), preview, 'Wrong HTTP indexing policy')
  assert.ok((await read('llms.txt')).includes(`${origin}/`), 'LLM navigation must use the deployment origin')
  const files = await readdir(directory, { recursive: true })
  assert.equal(files.some(file => file.includes('.zh-draft.') || file === 'zh/blog/drafts.html'), false, 'Draft pages must not be deployed')
  assert.equal(files.includes('sitemap.xml'), !preview, 'Only stable documentation should publish a sitemap')
  if (!preview) {
    assert.ok((await read('sitemap.xml')).includes(`${origin}/`), 'Sitemap must use the stable origin')
    assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`), 'Stable robots.txt must link its sitemap')
  }
  assert.ok((await read('__mokup/index.html')).includes('<html'), 'The built Playground must exist')
  assert.ok((await read('mokup-sw.js')).trim().length > 0, 'The built service worker must exist')
}
