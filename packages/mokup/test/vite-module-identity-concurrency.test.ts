import type { Plugin } from 'vite'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { loadModuleWithVite } from '@mokup/core'
import { normalizePath } from 'vite'
import { describe, expect, it } from 'vitest'
import { cleanId, deferred, moduleIds, querySuffix, within, withViteFixture } from './vite-module-identity.helpers'

describe('real Vite module reload concurrency', () => {
  it.each(['same file', 'directory link', 'plugin redirect'])('independently refreshes an overlapping load reached through %s', async (input) => {
    await withViteFixture(async ({ root, createServer }) => {
      const realDirectory = path.join(root, 'real')
      const aliasDirectory = path.join(root, 'alias')
      await fs.mkdir(realDirectory)
      const file = path.join(realDirectory, 'entry.ts')
      let secondFile = file
      if (input === 'directory link') {
        await fs.symlink(realDirectory, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir')
        secondFile = path.join(aliasDirectory, 'entry.ts')
      }
      else if (input === 'plugin redirect') {
        secondFile = path.join(root, 'redirect.ts')
      }
      await fs.writeFile(file, 'export const value: number = 1\n')
      const entered = deferred()
      const gate = deferred()
      let firstTransform = true
      const plugin: Plugin = {
        name: 'mokup-test-transform-gate',
        enforce: 'pre',
        resolveId(source) {
          if (input === 'plugin redirect' && cleanId(source) === normalizePath(secondFile)) {
            return `${normalizePath(file)}${querySuffix(source)}`
          }
          return null
        },
        async transform(code, id) {
          if (cleanId(id) === normalizePath(file) && firstTransform) {
            firstTransform = false
            entered.resolve()
            await gate.promise
            return code
          }
          return null
        },
      }
      const server = await createServer({ plugins: [plugin] })
      const pending: Promise<unknown>[] = []
      try {
        const first = loadModuleWithVite(server, file)
        pending.push(first)
        void first.catch(() => undefined)
        await within(entered.promise)
        await fs.writeFile(file, 'export const value: number = 2\n')
        const second = loadModuleWithVite(server, secondFile)
        pending.push(second)
        void second.catch(() => undefined)
        expect((await within(second))?.value).toBe(2)
        gate.resolve()
        const [initial, refreshed] = await within(Promise.all([first, second]))
        expect(initial?.value).toBe(1)
        expect(refreshed?.value).toBe(2)
        expect(moduleIds(server, file)).toHaveLength(2)
        expect((await loadModuleWithVite(server, file))?.value).toBe(2)
        expect(moduleIds(server, file)).toHaveLength(2)
      }
      finally {
        gate.resolve()
        await Promise.allSettled(pending)
      }
    })
  }, 20000)
})
