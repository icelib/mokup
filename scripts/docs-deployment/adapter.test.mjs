/* eslint test/no-import-node-test: off -- Exercise the deploy adapter without a real provider or CLI process. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { it } from 'node:test'
import { deployDocumentation } from './adapter.mjs'
import { buildIdentity, deploymentMessage, docsTargets } from './identity.mjs'
import { writeDeploymentFiles } from './output.mjs'

const versionId = '12345678-1234-1234-1234-123456789abc'

async function fixture(t) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'mokup-docs-adapter-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const directory = path.join(temporary, 'dist')
  const env = {
    REPO_DOCS_SITE: 'website',
    REPO_DOCS_CHANNEL: 'stable',
    REPO_DOCS_SOURCE_SHA: 'a'.repeat(40),
    REPO_DOCS_DEPLOYMENT_ID: 'b'.repeat(64),
    REPO_DOCS_RELEASE_ID: 'c'.repeat(64),
    REPO_DOCS_RESULT_FILE: path.join(temporary, 'result.json'),
    REPO_DOCS_URL: docsTargets.stable.url,
    GITHUB_ACTIONS: 'true',
    GITHUB_RUN_ID: '1',
    REPO_DOCS_CONCURRENCY_GROUP: 'docs-website-stable',
    CLOUDFLARE_API_TOKEN: 'fixture-token',
    CLOUDFLARE_ACCOUNT_ID: 'd'.repeat(32),
  }
  const identity = buildIdentity(env)
  const origin = docsTargets.stable.url
  const html = `<html><head><link rel="canonical" href="${origin}/"><meta property="og:image" content="${origin}/brand/mokup-logo.svg"></head></html>`
  const files = {
    'docs-build.json': JSON.stringify(identity),
    'index.html': html,
    'zh/index.html': html,
    'getting-started/quick-start/index.html': html,
    'llms.txt': `${origin}/`,
    'sitemap.xml': `<urlset><url><loc>${origin}/</loc></url></urlset>`,
    '__mokup/index.html': '<html>Playground</html>',
    'mokup-sw.js': 'self.addEventListener("fetch", () => {})',
  }
  for (const [filename, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, filename)), { recursive: true })
    await writeFile(path.join(directory, filename), content)
  }
  await writeDeploymentFiles(directory, { preview: false, origin })
  const state = { active: undefined, reads: 0, uploads: 0, readError: undefined, uploadError: undefined, afterUpload: undefined }
  const request = async (url) => {
    state.reads++
    assert.ok(url.includes('/workers/scripts/mokup-website/'))
    if (state.readError) {
      throw state.readError
    }
    const active = state.active
    const result = url.endsWith('/deployments')
      ? { deployments: active ? [{ created_on: '2026-10-23T00:00:00Z', versions: [{ version_id: active.id, percentage: active.percentage }] }] : [] }
      : { id: active.id, annotations: { 'workers/message': active.message } }
    return Response.json({ success: true, result })
  }
  const upload = async (target, actualIdentity) => {
    state.uploads++
    assert.deepEqual(target, docsTargets.stable)
    assert.deepEqual(actualIdentity, identity)
    if (state.uploadError) {
      throw state.uploadError
    }
    state.active = { id: versionId, percentage: 100, message: deploymentMessage(identity) }
    state.afterUpload?.()
    return versionId
  }
  return {
    env,
    identity,
    directory,
    state,
    deploy: () => deployDocumentation({ channel: 'stable', env, directory, upload, request }),
    readResult: () => readFile(env.REPO_DOCS_RESULT_FILE, 'utf8').then(JSON.parse),
  }
}

for (const [name, invalidate, message] of [
  ['deployment identity', async ({ env }) => { env.REPO_DOCS_SOURCE_SHA = '' }, /Direct website deployment/u],
  ['stable workflow', async ({ env }) => { env.REPO_DOCS_CONCURRENCY_GROUP = '' }, /managed docs-website-stable/u],
  ['stale build identity', async ({ directory, identity }) => writeFile(path.join(directory, 'docs-build.json'), JSON.stringify({ ...identity, channel: 'preview' })), /artifact does not match/u],
  ['incomplete build', async ({ directory }) => rm(path.join(directory, '__mokup/index.html')), /ENOENT/u],
]) {
  it(`rejects ${name} before contacting the provider or writing a result`, async (t) => {
    const run = await fixture(t)
    await invalidate(run)
    await assert.rejects(run.deploy(), message)
    assert.equal(run.state.reads, 0)
    assert.equal(run.state.uploads, 0)
    await assert.rejects(run.readResult(), { code: 'ENOENT' })
  })
}

it('does not upload or write a result when the initial provider lookup fails', async (t) => {
  const run = await fixture(t)
  run.state.readError = new Error('provider unavailable')
  await assert.rejects(run.deploy(), /provider unavailable/u)
  assert.equal(run.state.uploads, 0)
  await assert.rejects(run.readResult(), { code: 'ENOENT' })
})

it('does not write a result when upload fails', async (t) => {
  const run = await fixture(t)
  run.state.uploadError = new Error('upload failed')
  await assert.rejects(run.deploy(), /upload failed/u)
  assert.equal(run.state.uploads, 1)
  await assert.rejects(run.readResult(), { code: 'ENOENT' })
})

for (const [name, invalidate, message] of [
  ['is not active', (state) => { state.active = undefined }, /not confirmed active/u],
  ['is replaced by another version', (state) => { state.active.id = '87654321-4321-4321-4321-cba987654321' }, /not confirmed active/u],
  ['receives only part of traffic', (state) => { state.active.percentage = 50 }, /100%/u],
]) {
  it(`does not write a result when the uploaded version ${name}`, async (t) => {
    const run = await fixture(t)
    run.state.afterUpload = () => invalidate(run.state)
    await assert.rejects(run.deploy(), message)
    assert.equal(run.state.uploads, 1)
    await assert.rejects(run.readResult(), { code: 'ENOENT' })
  })
}

it('reuses a successful upload after post-upload verification fails', async (t) => {
  const run = await fixture(t)
  run.state.afterUpload = () => {
    run.state.readError = new Error('verification unavailable')
  }
  await assert.rejects(run.deploy(), /verification unavailable/u)
  await assert.rejects(run.readResult(), { code: 'ENOENT' })
  run.state.readError = undefined
  const expected = { versionId, url: docsTargets.stable.url }
  assert.deepEqual(await run.deploy(), expected)
  assert.deepEqual(await run.readResult(), expected)
  assert.equal(run.state.uploads, 1)
})

it('repeated deployment reconciles the same active version without uploading again', async (t) => {
  const run = await fixture(t)
  const expected = { versionId, url: docsTargets.stable.url }
  assert.deepEqual(await run.deploy(), expected)
  assert.deepEqual(await run.readResult(), expected)
  await rm(run.env.REPO_DOCS_RESULT_FILE)
  assert.deepEqual(await run.deploy(), expected)
  assert.deepEqual(await run.readResult(), expected)
  assert.equal(run.state.uploads, 1)
})

it('recovers a failed result write without uploading the confirmed version again', async (t) => {
  const run = await fixture(t)
  const resultFile = run.env.REPO_DOCS_RESULT_FILE
  run.env.REPO_DOCS_RESULT_FILE = run.directory
  await assert.rejects(run.deploy(), { code: 'EISDIR' })
  run.env.REPO_DOCS_RESULT_FILE = resultFile
  await assert.rejects(run.readResult(), { code: 'ENOENT' })
  const expected = { versionId, url: docsTargets.stable.url }
  assert.deepEqual(await run.deploy(), expected)
  assert.deepEqual(await run.readResult(), expected)
  assert.equal(run.state.uploads, 1)
})
