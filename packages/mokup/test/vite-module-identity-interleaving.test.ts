import type { Plugin, ViteDevServer } from 'vite'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { loadModuleWithVite } from '@mokup/core'
import { normalizePath } from 'vite'
import { describe, expect, it } from 'vitest'
import { cleanId, deferred, querySuffix, within, withViteFixture } from './vite-module-identity.helpers'

describe('overlapping Vite resolver discovery', () => {
  it('refreshes independent entries without invoking an unfinished entry resolver', async () => {
    await withViteFixture(async ({ root, createServer }) => {
      const requested = path.join(root, 'requested.ts')
      const target = path.join(root, 'actual.ts')
      const shared = path.join(root, 'shared.ts')
      const independent = path.join(root, 'independent.ts')
      await fs.writeFile(target, 'export const value = 1\n')
      await fs.writeFile(shared, 'export const value = 10\n')
      await fs.writeFile(independent, 'export const value = 20\n')
      const entered = deferred()
      const release = deferred()
      let cancelled = false
      let calls = 0
      let server!: ViteDevServer
      const pending: Promise<unknown>[] = []
      function track<T>(operation: Promise<T>) {
        pending.push(operation)
        void operation.catch(() => undefined)
        return operation
      }
      const plugin: Plugin = {
        name: 'mokup-test-independent-resolver-discovery',
        enforce: 'pre',
        async resolveId(source) {
          if (cleanId(source) !== normalizePath(requested)) {
            return null
          }
          if (++calls === 1) {
            entered.resolve()
            await release.promise
            if (!cancelled) {
              expect((await track(loadModuleWithVite(server, shared)))?.value).toBe(11)
            }
          }
          return `${normalizePath(target)}${querySuffix(source)}`
        },
      }
      server = await createServer({ plugins: [plugin] })
      try {
        const first = track(loadModuleWithVite(server, requested))
        await within(entered.promise)
        expect((await within(track(loadModuleWithVite(server, shared))))?.value).toBe(10)
        await fs.writeFile(shared, 'export const value = 11\n')
        expect((await within(track(loadModuleWithVite(server, shared))))?.value).toBe(11)
        expect((await within(track(loadModuleWithVite(server, independent))))?.value).toBe(20)
        expect(calls).toBe(1)
        release.resolve()
        expect((await within(first))?.value).toBe(1)
      }
      finally {
        cancelled = true
        release.resolve()
        await within(Promise.allSettled(pending))
      }
    })
  }, 20000)
})
