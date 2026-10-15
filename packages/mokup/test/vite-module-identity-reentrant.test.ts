import type { Plugin, ViteDevServer } from 'vite'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { loadModuleWithVite } from '@mokup/core'
import { normalizePath } from 'vite'
import { describe, expect, it } from 'vitest'
import { cleanId, deferred, moduleIds, querySuffix, within, withViteFixture } from './vite-module-identity.helpers'

describe('real Vite resolver load contexts', () => {
  it('allows a resolver to load another entry and keeps both refreshable', async () => {
    await withViteFixture(async ({ root, createServer }) => {
      const requested = path.join(root, 'requested.ts')
      const target = path.join(root, 'actual.ts')
      const dependency = path.join(root, 'independent.ts')
      await fs.writeFile(target, 'export const value: number = 1\n')
      await fs.writeFile(dependency, 'export const value: number = 10\n')
      const cancellation = deferred()
      const cancelledError = new Error('Cancelled nested module fixture')
      const pending: Promise<unknown>[] = []
      const nestedValues: unknown[] = []
      let cancelled = false
      let resolveCalls = 0
      let server!: ViteDevServer
      function track<T>(loading: Promise<T>): Promise<T> {
        pending.push(loading)
        void loading.catch(() => undefined)
        return loading
      }
      const plugin: Plugin = {
        name: 'mokup-test-resolver-nested-load',
        enforce: 'pre',
        async resolveId(source) {
          if (cleanId(source) !== normalizePath(requested)) {
            return null
          }
          if (cancelled) {
            throw cancelledError
          }
          // Bound a broken implementation's recursive discovery until finally cancels it.
          if (++resolveCalls > 12) {
            await cancellation.promise
            throw cancelledError
          }
          const loading = track(loadModuleWithVite(server, dependency))
          const loaded = await Promise.race([
            loading,
            cancellation.promise.then(() => {
              throw cancelledError
            }),
          ])
          nestedValues.push(loaded?.value)
          return `${normalizePath(target)}${querySuffix(source)}`
        },
      }
      server = await createServer({ plugins: [plugin] })
      try {
        expect((await within(track(loadModuleWithVite(server, requested))))?.value).toBe(1)
        expect(nestedValues.length).toBeGreaterThan(0)
        expect(nestedValues.every(value => value === 10)).toBe(true)
        const targetIds = moduleIds(server, target)
        const dependencyIds = moduleIds(server, dependency)
        const graphSize = server.moduleGraph.idToModuleMap.size
        expect(targetIds).toHaveLength(1)
        expect(dependencyIds).toHaveLength(1)

        for (let value = 2; value <= 4; value++) {
          await fs.writeFile(target, `export const value: number = ${value}\n`)
          await fs.writeFile(dependency, `export const value: number = ${value * 10}\n`)
          expect((await within(track(loadModuleWithVite(server, requested))))?.value).toBe(value)
          expect((await within(track(loadModuleWithVite(server, dependency))))?.value).toBe(value * 10)
          expect(moduleIds(server, target)).toEqual(targetIds)
          expect(moduleIds(server, dependency)).toEqual(dependencyIds)
          expect(server.moduleGraph.idToModuleMap.size).toBe(graphSize)
        }
      }
      finally {
        cancelled = true
        cancellation.resolve()
        await within(Promise.allSettled(pending))
      }
    })
  }, 20000)

  it.each(['first', 'second'])('lets another top-level file refresh while %s is still evaluating', async (blockedName) => {
    await withViteFixture(async ({ root, createServer }) => {
      const first = path.join(root, 'first.ts')
      const second = path.join(root, 'second.ts')
      const blocked = blockedName === 'first' ? first : second
      const independent = blockedName === 'first' ? second : first
      await fs.writeFile(first, 'export const value: number = 1\n')
      await fs.writeFile(second, 'export const value: number = 1\n')
      const entered = deferred()
      const gate = deferred()
      let blockFirstTransform = true
      const plugin: Plugin = {
        name: 'mokup-test-independent-load-contexts',
        async transform(code, id) {
          if (cleanId(id) === normalizePath(blocked) && blockFirstTransform) {
            blockFirstTransform = false
            entered.resolve()
            await gate.promise
            return code
          }
          return null
        },
      }
      const server = await createServer({ plugins: [plugin] })
      const pending: Promise<unknown>[] = []
      function track<T>(loading: Promise<T>): Promise<T> {
        pending.push(loading)
        void loading.catch(() => undefined)
        return loading
      }
      try {
        let blockedSettled = false
        const blockedLoad = track(loadModuleWithVite(server, blocked).then((loaded) => {
          blockedSettled = true
          return loaded
        }))
        await within(entered.promise)
        expect((await within(track(loadModuleWithVite(server, independent))))?.value).toBe(1)
        const ids = moduleIds(server, independent)

        await fs.writeFile(independent, 'export const value: number = 2\n')
        expect((await within(track(loadModuleWithVite(server, independent))))?.value).toBe(2)
        expect(moduleIds(server, independent)).toEqual(ids)
        expect(blockedSettled).toBe(false)

        gate.resolve()
        expect((await within(blockedLoad))?.value).toBe(1)
        const blockedIds = moduleIds(server, blocked)
        await fs.writeFile(blocked, 'export const value: number = 3\n')
        expect((await within(track(loadModuleWithVite(server, blocked))))?.value).toBe(3)
        expect(moduleIds(server, blocked)).toEqual(blockedIds)
        expect(moduleIds(server, first)).toHaveLength(1)
        expect(moduleIds(server, second)).toHaveLength(1)
      }
      finally {
        gate.resolve()
        await within(Promise.allSettled(pending))
      }
    })
  }, 20000)
})
