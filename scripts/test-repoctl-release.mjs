import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import { GitHubApiError, GitHubClient } from 'repoctl'

const branch = 'repoctl-release-state'
const key = 'a'.repeat(64)
const checkpointPath = `.repoctl-release/${key}.json`
const source = 'b'.repeat(40)
const state = {
  schemaVersion: 1,
  writer: 'fixture-run',
  repository: 'fixture/project',
  candidates: [{ name: 'fixture', version: '1.0.1' }],
  packages: [{ name: 'fixture', version: '1.0.1', target: source }],
  accepted: [],
  npm: 'pending',
  metadata: [],
  hooks: {},
  complete: false,
}

// Model the GitHub storage boundary without a token, network, or repository writes.
function createFixture(options = {}) {
  const requests = []
  const files = new Map()
  let reference = options.branchExists ? { sha: 'existing-commit' } : undefined
  let tree
  let commit
  let revision = 0
  if (options.checkpoint) {
    files.set(checkpointPath, {
      sha: 'existing-blob',
      content: Buffer.from(JSON.stringify(options.checkpoint)).toString('base64'),
    })
  }
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status })
  const client = new GitHubClient({
    token: 'local-fixture',
    repository: 'fixture/project',
    retryAttempts: 1,
    fetch: async (url, init) => {
      const endpoint = new URL(url).pathname.replace('/repos/fixture/project', '')
      const method = init.method
      const body = init.body ? JSON.parse(init.body) : undefined
      requests.push({ method, endpoint, body })
      if (method === 'GET' && endpoint === `/git/ref/heads/${branch}`) {
        return reference ? response({ object: reference }) : response({ message: 'Not Found' }, 404)
      }
      if (method === 'POST' && endpoint === '/git/trees') {
        tree = body
        return response({ sha: 'checkpoint-tree' }, 201)
      }
      if (method === 'POST' && endpoint === '/git/commits') {
        commit = body
        return response({ sha: 'checkpoint-commit' }, 201)
      }
      if (method === 'POST' && endpoint === '/git/refs') {
        assert.equal(body.ref, `refs/heads/${branch}`)
        if (options.concurrentRef) {
          reference = { sha: 'concurrent-checkpoint-commit' }
          return response({ message: 'Reference already exists' }, 422)
        }
        if (options.refError) {
          return response({ message: 'Resource not accessible by integration' }, 403)
        }
        assert.ok(tree, 'a checkpoint tree must exist before creating the branch')
        assert.ok(commit, 'a checkpoint commit must exist before creating the branch')
        reference = { sha: body.sha }
        for (const entry of tree.tree) {
          files.set(entry.path, { content: Buffer.from(entry.content).toString('base64') })
        }
        return response({ ref: body.ref, object: reference }, 201)
      }
      if (endpoint === `/contents/${checkpointPath}`) {
        const current = files.get(checkpointPath)
        if (method === 'GET') {
          return current ? response(current) : response({ message: 'Not Found' }, 404)
        }
        if (method === 'PUT') {
          assert.ok(reference, 'the checkpoint branch must exist before writing contents')
          assert.equal(body.branch, branch)
          if (options.writeError || body.sha !== current?.sha) {
            return response({ message: 'Checkpoint revision conflict' }, 409)
          }
          const updated = { sha: `checkpoint-blob-${++revision}`, content: body.content }
          files.set(checkpointPath, updated)
          return response({ content: updated }, 201)
        }
      }
      assert.fail(`Unexpected GitHub request: ${method} ${endpoint}`)
    },
  })
  return {
    client,
    requests,
    files,
    get reference() {
      return reference
    },
  }
}

for (const packages of [state.packages, []]) {
  test(`initial checkpoint uses an independent branch (${packages.length} packages)`, async () => {
    const fixture = createFixture()
    const checkpoint = { ...state, packages }
    const revision = await fixture.client.writeReleaseState(key, checkpoint)
    const tree = fixture.requests.find(request => request.endpoint === '/git/trees').body
    const commit = fixture.requests.find(request => request.endpoint === '/git/commits').body
    assert.equal(tree.base_tree, undefined, 'source files and workflows must not enter the state branch')
    assert.deepEqual(tree.tree.map(entry => entry.path), ['.repoctl-release/README.md'])
    assert.ok(tree.tree[0].content)
    assert.equal(tree.tree[0].mode, '100644')
    assert.equal(tree.tree[0].type, 'blob')
    assert.deepEqual(commit.parents, [], 'checkpoint history must not depend on a release source commit')
    assert.equal(commit.tree, 'checkpoint-tree')
    assert.equal(fixture.reference.sha, 'checkpoint-commit')
    assert.ok(!JSON.stringify(fixture.requests.filter(request => request.endpoint.startsWith('/git/'))).includes(source))
    assert.deepEqual([...fixture.files.keys()].sort(), ['.repoctl-release/README.md', checkpointPath].sort())
    assert.deepEqual(await fixture.client.readReleaseState(key), { revision, state: checkpoint })
  })
}

test('a new release writes into an existing state branch without rebuilding it', async () => {
  const fixture = createFixture({ branchExists: true })
  const revision = await fixture.client.writeReleaseState(key, state)
  assert.equal(fixture.reference.sha, 'existing-commit')
  assert.ok(!fixture.requests.some(request => request.method === 'POST'))
  assert.deepEqual(await fixture.client.readReleaseState(key), { revision, state })
})

test('an existing checkpoint uses its revision for a compare-and-swap update', async () => {
  const fixture = createFixture({ branchExists: true, checkpoint: state })
  const updated = { ...state, complete: true }
  const revision = await fixture.client.writeReleaseState(key, updated, 'existing-blob')
  assert.deepEqual(fixture.requests.map(request => request.method), ['PUT'])
  assert.equal(fixture.requests[0].body.sha, 'existing-blob')
  assert.deepEqual(await fixture.client.readReleaseState(key), { revision, state: updated })
})

test('concurrent branch initialization continues after verifying that the branch exists', async () => {
  const fixture = createFixture({ concurrentRef: true })
  const revision = await fixture.client.writeReleaseState(key, state)
  assert.equal(fixture.reference.sha, 'concurrent-checkpoint-commit')
  assert.equal(fixture.requests.filter(request => request.endpoint === `/git/ref/heads/${branch}`).length, 2)
  assert.deepEqual(await fixture.client.readReleaseState(key), { revision, state })
})

test('branch initialization preserves the original authorization error when recovery also fails', async () => {
  const fixture = createFixture({ refError: true })
  await assert.rejects(fixture.client.writeReleaseState(key, state), (error) => {
    assert.ok(error instanceof GitHubApiError)
    assert.equal(error.status, 403)
    assert.match(error.message, /POST \/git\/refs.*Resource not accessible by integration/)
    return true
  })
  assert.ok(!fixture.requests.some(request => request.method === 'PUT'))
})

test('a stale revision cannot overwrite a different checkpoint', async () => {
  const fixture = createFixture({ branchExists: true, checkpoint: { ...state, complete: true } })
  await assert.rejects(fixture.client.writeReleaseState(key, state, 'stale-blob'), /another publisher advanced it/)
  assert.equal(fixture.files.get(checkpointPath).sha, 'existing-blob')
})

test('a failed write recovers only when the persisted checkpoint matches exactly', async () => {
  const fixture = createFixture({ branchExists: true, checkpoint: state, writeError: true })
  assert.equal(await fixture.client.writeReleaseState(key, state, 'existing-blob'), 'existing-blob')
})
