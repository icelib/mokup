/* eslint test/no-import-node-test: off -- Deployment checks run with node --test outside the package Vitest suites. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { it } from 'node:test'
import { activeMatchingVersion, cloudflareClient, readDeploymentVersion } from './cloudflare.mjs'
import { assertBuildIdentity, assertDeploymentContext, buildIdentity, deploymentMessage, docsTargets, resolveChannel } from './identity.mjs'
import { writeDeploymentFiles } from './output.mjs'

const versionId = '12345678-1234-1234-1234-123456789abc'
const env = {
  REPO_DOCS_SITE: 'website',
  REPO_DOCS_CHANNEL: 'stable',
  REPO_DOCS_SOURCE_SHA: 'a'.repeat(40),
  REPO_DOCS_DEPLOYMENT_ID: 'b'.repeat(64),
  REPO_DOCS_RELEASE_ID: 'release-completed',
  REPO_DOCS_RESULT_FILE: '/tmp/result.json',
  REPO_DOCS_URL: docsTargets.stable.url,
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '1',
  REPO_DOCS_CONCURRENCY_GROUP: 'docs-website-stable',
}
const identity = buildIdentity(env)

function provider({ message = deploymentMessage(identity), versions = [{ version_id: versionId, percentage: 100 }] } = {}) {
  return async (_worker, endpoint) => endpoint === 'deployments'
    ? { deployments: [{ created_on: '2026-10-23T00:00:00Z', versions }] }
    : { id: versionId, annotations: { 'workers/message': message } }
}

it('local builds default to preview while direct or unknown-channel deployment is rejected', () => {
  assert.equal(buildIdentity({}, 'a'.repeat(40)).channel, 'preview')
  assert.throws(() => resolveChannel('production'), /Unknown documentation channel/)
  assert.throws(() => assertDeploymentContext({}, 'preview'), /Direct website deployment/)
  assert.throws(() => buildIdentity({ REPO_DOCS_CHANNEL: 'stable' }), /Direct website deployment/)
})

it('stable requires the completed release, workflow, source and serialized production context', () => {
  assert.doesNotThrow(() => assertDeploymentContext(env, 'stable'))
  for (const key of ['REPO_DOCS_RELEASE_ID', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'REPO_DOCS_CONCURRENCY_GROUP']) {
    assert.throws(() => assertDeploymentContext({ ...env, [key]: '' }, 'stable'), /managed docs-website-stable/)
  }
  for (const key of ['REPO_DOCS_SITE', 'REPO_DOCS_SOURCE_SHA', 'REPO_DOCS_DEPLOYMENT_ID', 'REPO_DOCS_RESULT_FILE', 'REPO_DOCS_URL']) {
    assert.throws(() => assertDeploymentContext({ ...env, [key]: '' }, 'stable'), /Direct website deployment/)
  }
})

it('a stale or preview build cannot be sent to production', () => {
  assert.doesNotThrow(() => assertBuildIdentity(identity, identity))
  for (const key of Object.keys(identity)) {
    assert.throws(() => assertBuildIdentity({ ...identity, [key]: 'mismatch' }, identity), /artifact does not match/)
  }
  assert.throws(() => assertDeploymentContext({ ...env, REPO_DOCS_CHANNEL: 'preview' }, 'stable'), /Direct website deployment/)
})

it('retries reconcile only the matching version receiving all traffic', async () => {
  assert.equal(await activeMatchingVersion(provider(), 'mokup-website', identity), versionId)
  assert.equal(await activeMatchingVersion(provider({ message: 'another-release' }), 'mokup-website', identity), undefined)
  assert.equal(await activeMatchingVersion(async () => undefined, 'mokup-website-next', identity), undefined)
  await assert.rejects(activeMatchingVersion(provider({ versions: [{ version_id: versionId, percentage: 50 }] }), 'mokup-website', identity), /100%/)
  await assert.rejects(activeMatchingVersion(async () => ({}), 'mokup-website', identity), /invalid deployments/)
})

it('Wrangler output must identify the intended Worker and environment', () => {
  const output = [
    { type: 'deploy', worker_name: 'mokup-website-next', wrangler_environment: 'next', version_id: 'preview-version' },
    { type: 'deploy', worker_name: 'mokup-website', version_id: 'stable-version' },
  ].map(entry => JSON.stringify(entry)).join('\n')
  assert.equal(readDeploymentVersion(output, 'mokup-website', ''), 'stable-version')
  assert.equal(readDeploymentVersion(output, 'mokup-website-next', 'next'), 'preview-version')
  assert.throws(() => readDeploymentVersion(output, 'mokup-website-next', ''), /did not report/)
  assert.throws(() => readDeploymentVersion('{broken', 'mokup-website', ''), SyntaxError)
})

it('only an explicit missing Worker may be treated as a first deployment', async () => {
  const credentials = { CLOUDFLARE_API_TOKEN: 'fixture-token', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) }
  const missing = cloudflareClient(credentials, async (url, options) => {
    assert.match(url, /workers\/scripts\/mokup-website-next\//u)
    assert.equal(options.headers.Authorization, 'Bearer fixture-token')
    return Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 })
  })
  assert.equal(await missing('mokup-website-next', 'deployments', true), undefined)
  await assert.rejects(missing('mokup-website-next', 'versions/missing'), /HTTP 404/)
  const denied = cloudflareClient(credentials, async () => Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 403 }))
  await assert.rejects(denied('mokup-website', 'deployments', true), /HTTP 403/)
  assert.throws(() => cloudflareClient({}), /required to verify/)
})

it('preview outputs forbid indexing and a later stable build replaces that policy', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mokup-docs-output-'))
  const read = filename => readFile(path.join(directory, filename), 'utf8')
  try {
    await writeFile(path.join(directory, 'sitemap.xml'), '<urlset/>')
    await writeDeploymentFiles(directory, { preview: true, origin: docsTargets.preview.url })
    assert.equal(await read('robots.txt'), 'User-agent: *\nDisallow: /\n')
    assert.match(await read('_headers'), /X-Robots-Tag: noindex, nofollow/u)
    await assert.rejects(read('sitemap.xml'), { code: 'ENOENT' })
    await writeDeploymentFiles(directory, { preview: false, origin: docsTargets.stable.url })
    assert.equal(await read('robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${docsTargets.stable.url}/sitemap.xml\n`)
    assert.doesNotMatch(await read('_headers'), /noindex/u)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})
