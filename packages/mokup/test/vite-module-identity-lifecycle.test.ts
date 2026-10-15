import { promises as fs } from 'node:fs'
import path from 'node:path'
import { loadModuleWithVite } from '@mokup/core'
import { describe, expect, it, vi } from 'vitest'
import { deferred, moduleIds, within, withViteFixture } from './vite-module-identity.helpers'

describe('real Vite module graph replacement', () => {
  it('joins the new graph when restart overlaps entry resolution', async () => {
    await withViteFixture(async ({ root, createServer }) => {
      const file = path.join(root, 'restart.ts')
      await fs.writeFile(file, 'export const value: number = 1\n')
      const server = await createServer()
      const oldGraph = server.moduleGraph
      const resolveUrl = oldGraph.resolveUrl.bind(oldGraph)
      const entered = deferred()
      const release = deferred()
      let resolutions = 0
      const resolution = vi.spyOn(oldGraph, 'resolveUrl').mockImplementation(async (...args) => {
        const result = await resolveUrl(...args)
        if (++resolutions === 1) {
          entered.resolve()
          await release.promise
        }
        return result
      })
      const pending: Promise<unknown>[] = []
      try {
        const first = loadModuleWithVite(server, file)
        pending.push(first)
        void first.catch(() => undefined)
        await within(entered.promise)
        await within(server.restart())
        expect(server.moduleGraph).not.toBe(oldGraph)
        await fs.writeFile(file, 'export const value: number = 2\n')
        expect((await within(loadModuleWithVite(server, file)))?.value).toBe(2)
        const currentIds = moduleIds(server, file)
        expect(currentIds).toHaveLength(1)

        release.resolve()
        expect((await within(first))?.value).toBe(2)
        expect(moduleIds(server, file)).toEqual(currentIds)
      }
      finally {
        release.resolve()
        await within(Promise.allSettled(pending))
        resolution.mockRestore()
      }
    })
  }, 20000)
})
