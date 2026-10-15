import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { clean, deferred, requestPaths, slash, within, withResources } from './vite-compat-fixture.mjs'

async function withOptimizer(vite, action) {
  await withResources(vite, async (scope) => {
    const { directory, server: create } = scope
    const name = 'mokup-compat-optimized'
    const dependency = path.join(directory, 'node_modules', name)
    await fs.mkdir(dependency, { recursive: true })
    await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.cjs' }))
    await fs.writeFile(path.join(dependency, 'index.cjs'), 'module.exports = { count: 17 }')
    const first = path.join(directory, 'entry.ts')
    const second = path.join(directory, 'alias.ts')
    const unrelated = path.join(directory, 'independent.ts')
    const inputs = new Set([...requestPaths(directory, first), ...requestPaths(directory, second)])
    await fs.writeFile(first, 'export const unused = 0')
    await fs.writeFile(second, 'export const unused = 0')
    await fs.writeFile(unrelated, 'export const value: number = 23')
    const server = await create([{
      name: 'mokup-compat-optimizer-redirect',
      enforce: 'pre',
      async resolveId(id, _importer, options) {
        if (inputs.has(slash(clean(id)))) {
          assert.equal(options?.ssr, true)
          return this.resolve(name, slash(first), { ...options, skipSelf: true })
        }
      },
    }], false, {
      ssr: { noExternal: [name], optimizeDeps: { disabled: false, noDiscovery: true, include: [name] } },
    })
    await action({ ...scope, server, first, second, unrelated })
    const metadata = JSON.parse(await fs.readFile(path.join(server.config.cacheDir, 'deps_ssr', '_metadata.json'), 'utf8'))
    assert.ok(metadata.optimized[name], 'Fixture must exercise the SSR dependency optimizer')
  })
}

export async function smokeOptimizer(vite) {
  await withOptimizer(vite, async ({ server, first, load }) => {
    for (let iteration = 0; iteration < 2; iteration++) {
      const result = await load(server, first)
      assert.equal((result.default ?? result).count, 17)
    }
  })
  // A fresh server is essential: the first load must initialize the optimizer
  // before an independent concurrent refresh resolves the optimized identity.
  await withOptimizer(vite, async ({ directory, server, first, second, unrelated, load, gate }) => {
    const firstInputs = requestPaths(directory, first)
    const secondInputs = requestPaths(directory, second)
    const unrelatedInputs = requestPaths(directory, unrelated)
    const entered = deferred()
    const release = gate()
    const originalLoad = server.ssrLoadModule.bind(server)
    let firstCalls = 0
    let secondCalls = 0
    let unrelatedCalls = 0
    server.ssrLoadModule = async (...args) => {
      const request = slash(clean(args[0]))
      const isFirst = firstInputs.has(request)
      if (isFirst) {
        firstCalls++
      }
      if (secondInputs.has(request)) {
        secondCalls++
      }
      if (unrelatedInputs.has(request)) {
        unrelatedCalls++
      }
      const result = await originalLoad(...args)
      if (isFirst) {
        entered.resolve()
        await release.promise
      }
      return result
    }
    let firstCompleted = false
    const pendingFirst = load(server, first).then((result) => {
      firstCompleted = true
      return result
    })
    await within(Promise.race([entered.promise, pendingFirst.then(() => {
      throw new Error('First optimized SSR result bypassed its gate')
    })]), 'first optimized SSR result')
    const [secondResult, unrelatedResult] = await Promise.all([load(server, second), load(server, unrelated)])
    assert.equal((secondResult.default ?? secondResult).count, 17, 'An optimized alias must support independent concurrent refresh')
    assert.equal(unrelatedResult.value, 23, 'An independent entry must remain loadable')
    assert.equal(firstCompleted, false, 'The first optimized SSR result must remain gated')
    assert.equal(firstCalls, 1)
    assert.equal(secondCalls, 1)
    assert.equal(unrelatedCalls, 1)
    release.resolve()
    const firstResult = await pendingFirst
    assert.equal((firstResult.default ?? firstResult).count, 17)
  })
}
