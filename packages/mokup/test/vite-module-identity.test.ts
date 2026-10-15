import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { loadModuleWithVite } from '@mokup/core'
import { normalizePath } from 'vite'
import { describe, expect, it } from 'vitest'
import { moduleIds, withViteFixture } from './vite-module-identity.helpers'

describe('real Vite module identity and freshness', () => {
  it.each(['ts', 'js', 'mjs'])('reloads 30 .%s edits without accumulating module nodes', async (extension) => {
    await withViteFixture(async ({ root, createServer }) => {
      const file = path.join(root, `entry.${extension}`)
      const server = await createServer()
      let initialIds: Array<string | null> | undefined
      let initialGraphSize: number | undefined
      for (let value = 0; value < 30; value++) {
        await fs.writeFile(file, `export const value${extension === 'ts' ? ': number' : ''} = ${value}\n`)
        const loaded = await loadModuleWithVite(server, file)
        expect(loaded?.value).toBe(value)
        const ids = moduleIds(server, file)
        expect(ids).toHaveLength(1)
        initialIds ??= ids
        initialGraphSize ??= server.moduleGraph.idToModuleMap.size
        expect(ids).toEqual(initialIds)
        expect(server.moduleGraph.idToModuleMap.size).toBe(initialGraphSize)
      }
    })
  }, 20000)

  it('repairs an evaluation error without allocating another entry identity', async () => {
    await withViteFixture(async ({ root, createServer }) => {
      const file = path.join(root, 'repair.ts')
      const server = await createServer()
      await fs.writeFile(file, 'export const value: number = 1\n')
      expect((await loadModuleWithVite(server, file))?.value).toBe(1)
      const ids = moduleIds(server, file)

      await fs.writeFile(file, 'throw new Error("fixture evaluation failed")\n')
      await expect(loadModuleWithVite(server, file)).rejects.toThrow('fixture evaluation failed')
      expect(moduleIds(server, file)).toEqual(ids)

      await fs.writeFile(file, 'export const value: number = 2\n')
      expect((await loadModuleWithVite(server, file))?.value).toBe(2)
      expect(moduleIds(server, file)).toEqual(ids)
    })
  })

  it('keeps sibling query nodes while invalidating their previous evaluations', async () => {
    await withViteFixture(async ({ root, createServer }) => {
      const file = path.join(root, 'variants.js')
      const sibling = `${normalizePath(file)}?variant=sibling`
      const server = await createServer()
      await fs.writeFile(file, 'export const value = 1\n')
      expect((await server.ssrLoadModule(sibling))['value']).toBe(1)
      expect((await loadModuleWithVite(server, file))?.value).toBe(1)
      const ids = moduleIds(server, file)
      expect(ids).toHaveLength(2)

      await fs.writeFile(file, 'export const value = 2\n')
      expect((await loadModuleWithVite(server, file))?.value).toBe(2)
      expect((await server.ssrLoadModule(sibling))['value']).toBe(2)
      expect(moduleIds(server, file)).toEqual(ids)
    })
  })

  it('reloads an imported helper after Vite receives its file change', async () => {
    await withViteFixture(async ({ root, createServer }) => {
      const file = path.join(root, 'entry.ts')
      const helper = path.join(root, 'helper.ts')
      await fs.writeFile(file, 'export { value } from "./helper.ts"\n')
      await fs.writeFile(helper, 'export const value: number = 1\n')
      const server = await createServer()
      expect((await loadModuleWithVite(server, file))?.value).toBe(1)
      const entryIds = moduleIds(server, file)
      const helperIds = moduleIds(server, helper)
      const graphSize = server.moduleGraph.idToModuleMap.size

      await fs.writeFile(helper, 'export const value: number = 2\n')
      server.moduleGraph.onFileChange(normalizePath(helper))
      expect((await loadModuleWithVite(server, file))?.value).toBe(2)
      expect(moduleIds(server, file)).toEqual(entryIds)
      expect(moduleIds(server, helper)).toEqual(helperIds)
      expect(server.moduleGraph.idToModuleMap.size).toBe(graphSize)
    })
  })

  it.each([false, true])('refreshes directory links with preserveSymlinks=%s', async (preserveSymlinks) => {
    await withViteFixture(async ({ root, createServer }) => {
      const realDirectory = path.join(root, 'real')
      const aliasDirectory = path.join(root, 'alias')
      await fs.mkdir(realDirectory)
      await fs.symlink(realDirectory, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir')
      const file = path.join(realDirectory, 'entry.ts')
      const alias = path.join(aliasDirectory, 'entry.ts')
      const server = await createServer({ resolve: { preserveSymlinks } })
      await fs.writeFile(file, 'export const value: number = 0\n')
      expect((await loadModuleWithVite(server, alias))?.value).toBe(0)
      expect((await loadModuleWithVite(server, file))?.value).toBe(0)
      const realIds = moduleIds(server, file)
      const aliasIds = moduleIds(server, alias)
      const graphSize = server.moduleGraph.idToModuleMap.size
      expect(realIds).toHaveLength(preserveSymlinks ? 1 : 2)
      expect(aliasIds).toHaveLength(preserveSymlinks ? 1 : 0)

      for (let value = 1; value <= 6; value++) {
        await fs.writeFile(file, `export const value: number = ${value}\n`)
        expect((await loadModuleWithVite(server, value % 2 ? alias : file))?.value).toBe(value)
        expect(moduleIds(server, file)).toEqual(realIds)
        expect(moduleIds(server, alias)).toEqual(aliasIds)
        expect(server.moduleGraph.idToModuleMap.size).toBe(graphSize)
      }
    })
  }, 20000)
})
