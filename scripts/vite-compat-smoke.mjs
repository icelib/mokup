import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { inspect } from 'node:util'
import { clean, consumer, counts, deferred, requestPaths, slash, version, within, withResources } from './vite-compat-fixture.mjs'
import { smokeOptimizer } from './vite-compat-optimizer.mjs'

const alias = `vite${version?.replaceAll('.', '_')}`

async function basicCases(vite) {
  for (const preserve of [false, true]) {
    await withResources(vite, async ({ directory, server: create, load }) => {
      const real = path.join(directory, 'real')
      const linked = path.join(directory, 'linked')
      await fs.mkdir(real)
      await fs.symlink(real, linked, process.platform === 'win32' ? 'junction' : 'dir')
      const redirects = new Map()
      let redirected = 0
      const server = await create([{
        name: 'mokup-compat-redirect',
        enforce: 'pre',
        resolveId(id, _importer, options) {
          const target = redirects.get(slash(clean(id)))
          if (target) {
            assert.equal(options?.ssr, true, 'Entry resolution must be SSR-only')
            redirected++
            return `${target}${id.slice(clean(id).length)}`
          }
        },
      }], preserve)
      for (const extension of ['mjs', 'ts']) {
        for (const kind of ['real', 'symlink', 'redirect']) {
          const file = path.join(real, `${kind}.${extension}`)
          const requested = kind === 'symlink'
            ? path.join(linked, `${kind}.${extension}`)
            : kind === 'redirect' ? path.join(directory, `virtual.${extension}`) : file
          if (kind === 'redirect') {
            for (const request of requestPaths(directory, requested)) {
              redirects.set(request, slash(file))
            }
          }
          const resolved = kind === 'symlink' && preserve ? requested : file
          let initial
          for (let value = 0; value < 30; value++) {
            await fs.writeFile(file, `export const value${extension === 'ts' ? ': number' : ''} = ${value}`)
            assert.equal((await load(server, requested)).value, value)
            const current = counts(server, resolved)
            assert.equal(current.fileNodes, 1)
            initial ??= current
            assert.deepEqual(current, initial, `${kind}.${extension}: module identities grew`)
          }
        }
      }
      assert.ok(redirected > 0)
    })
  }
}

async function recoverErrors(vite) {
  await withResources(vite, async ({ directory, server: create, load }) => {
    const target = path.join(directory, 'target.ts')
    const requested = path.join(directory, 'unresolved.ts')
    const inputs = requestPaths(directory, requested)
    let shouldThrow = true
    const server = await create([{
      name: 'mokup-compat-resolve-error',
      enforce: 'pre',
      resolveId(id) {
        if (inputs.has(slash(clean(id)))) {
          if (shouldThrow) {
            throw new Error('intentional resolver failure')
          }
          return `${slash(target)}${id.slice(clean(id).length)}`
        }
      },
    }])
    await fs.writeFile(target, 'export const value: number = 1')
    await Promise.all([0, 1].map(() => assert.rejects(load(server, requested), /intentional resolver failure/)))
    shouldThrow = false
    assert.equal((await load(server, requested)).value, 1)
    const initial = counts(server, target)
    await fs.writeFile(target, 'throw new Error("intentional evaluation failure")')
    await assert.rejects(load(server, requested), /intentional evaluation failure/)
    await fs.writeFile(target, 'export const value: number = 2')
    assert.equal((await load(server, requested)).value, 2)
    assert.deepEqual(counts(server, target), initial)
  })
}

async function concurrentLoads(vite, variant) {
  await withResources(vite, async ({ directory, server: create, evaluationGate, load }) => {
    const file = path.join(directory, 'entry.ts')
    const aliasFile = path.join(directory, 'alias.ts')
    const aliases = requestPaths(directory, aliasFile)
    const firstInput = variant === 'query' ? `${file}?variant=first` : file
    const secondInput = variant === 'query' ? `${file}?variant=second` : variant === 'alias' ? aliasFile : file
    const server = await create([{
      name: 'mokup-compat-alias',
      enforce: 'pre',
      resolveId(id) {
        if (aliases.has(slash(clean(id)))) {
          return `${slash(file)}${id.slice(clean(id).length)}`
        }
      },
    }])
    const originalLoad = server.ssrLoadModule.bind(server)
    let calls = 0
    server.ssrLoadModule = (...args) => {
      calls++
      return originalLoad(...args)
    }
    let initial
    for (let iteration = 0; iteration < 8; iteration++) {
      const { key, entered, release } = evaluationGate()
      await fs.writeFile(file, `export const value: number = 1; const state = globalThis[${JSON.stringify(key)}]; state.entered(); await state.pending`)
      let firstCompleted = false
      const first = load(server, firstInput).then((result) => {
        firstCompleted = true
        return result
      })
      await within(Promise.race([entered.promise, first.then(() => {
        throw new Error('First SSR evaluation completed without reaching its gate')
      })]), 'first SSR evaluation')
      await fs.writeFile(file, 'export const value: number = 2')
      const second = await load(server, secondInput)
      assert.equal(second.value, 2, 'An independent concurrent refresh must see the updated source')
      assert.equal(firstCompleted, false, 'The first SSR evaluation must remain gated')
      assert.equal(calls, (iteration + 1) * 2)
      release.resolve()
      assert.equal((await first).value, 1)
      const current = counts(server, file)
      assert.equal(current.ids, 2)
      assert.equal(current.fileNodes, 2)
      if (current.runnerIds !== null) {
        assert.equal(current.runnerIds, 2)
        assert.equal(current.runnerUrls, 2)
      }
      // Vite 6 also records normalized URL aliases for these same two nodes.
      initial ??= current
      assert.deepEqual(current, initial, `${variant}: concurrent refresh identities grew at iteration ${iteration}`)
    }
  })
}

async function crossServer(vite) {
  await withResources(vite, async ({ directory, server: create, gate, load }) => {
    const file = path.join(directory, 'overlap.ts')
    const inputs = requestPaths(directory, file)
    await fs.writeFile(file, 'export const owner = "disk"')
    const gates = {
      first: { entered: deferred(), release: gate() },
      second: { entered: deferred(), release: gate() },
    }
    const plugin = owner => ({
      name: `mokup-compat-owner-${owner}`,
      enforce: 'pre',
      async load(id) {
        if (inputs.has(slash(clean(id)))) {
          gates[owner].entered.resolve()
          await gates[owner].release.promise
          return `export const owner: string = ${JSON.stringify(owner)}`
        }
      },
    })
    const first = await create([plugin('first')])
    const second = await create([plugin('second')])
    const pendingFirst = load(first, file)
    await within(Promise.race([gates.first.entered.promise, pendingFirst.then(() => {
      throw new Error('First server completed without reaching its gate')
    })]), 'first server load')
    const pendingSecond = load(second, file)
    await within(Promise.race([gates.second.entered.promise, pendingSecond.then(() => {
      throw new Error('Second server completed without reaching its own gate')
    })]), 'second concurrent server load')
    gates.second.release.resolve()
    assert.equal((await pendingSecond).owner, 'second')
    gates.first.release.resolve()
    assert.equal((await pendingFirst).owner, 'first')
  })
}

async function main() {
  assert.match(version ?? '', /^\d+\.\d+\.\d+$/, 'Expected an exact Vite version')
  const manifest = JSON.parse(await fs.readFile(path.join(consumer, 'node_modules', alias, 'package.json'), 'utf8'))
  assert.equal(manifest.version, version)
  const vite = await import(alias)
  await basicCases(vite)
  await recoverErrors(vite)
  for (const variant of ['same', 'alias', 'query']) {
    await concurrentLoads(vite, variant)
  }
  await crossServer(vite)
  if (version === '5.0.0') {
    await smokeOptimizer(vite)
  }
  process.stdout.write(`Vite ${version} ok: 360 fresh loads, bounded graphs, paths, resolver recovery, independent concurrent refresh, server isolation\n`)
}

main().catch((error) => {
  process.stderr.write(`${inspect(error, { depth: 8 })}\n`)
  process.exitCode = 1
})
