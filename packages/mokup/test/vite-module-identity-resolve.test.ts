import type { Plugin } from 'vite'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { loadModuleWithVite } from '@mokup/core'
import { normalizePath } from 'vite'
import { describe, expect, it } from 'vitest'
import { cleanId, moduleIds, querySuffix, withViteFixture } from './vite-module-identity.helpers'

describe('real Vite resolution and server isolation', () => {
  it('invalidates the SSR redirect target without asking the client resolver', async () => {
    await withViteFixture(async ({ root, createServer }) => {
      const requested = path.join(root, 'requested.ts')
      const target = path.join(root, 'actual.ts')
      const modes: Array<boolean | undefined> = []
      const plugin: Plugin = {
        name: 'mokup-test-ssr-redirect',
        enforce: 'pre',
        resolveId(source, _importer, options) {
          if (cleanId(source) !== normalizePath(requested)) {
            return null
          }
          modes.push(options.ssr)
          if (!options.ssr) {
            throw new Error('Client resolution must not be requested')
          }
          return `${normalizePath(target)}${querySuffix(source)}`
        },
      }
      const server = await createServer({ plugins: [plugin] })
      await fs.writeFile(target, 'export const value: number = 1\n')
      expect((await loadModuleWithVite(server, requested))?.value).toBe(1)
      const ids = moduleIds(server, target)
      expect(ids).toHaveLength(1)

      await fs.writeFile(target, 'export const value: number = 2\n')
      expect((await loadModuleWithVite(server, requested))?.value).toBe(2)
      expect(moduleIds(server, target)).toEqual(ids)
      expect(moduleIds(server, requested)).toEqual([])
      expect(modes.length).toBeGreaterThan(0)
      expect(modes.every(mode => mode === true)).toBe(true)
    })
  })

  it('recovers a failed resolution without rotating unrelated or successfully resolved entries', async () => {
    await withViteFixture(async ({ root, createServer }) => {
      const requested = path.join(root, 'retry.ts')
      const target = path.join(root, 'actual.ts')
      const stable = path.join(root, 'stable.ts')
      const attemptedIds = new Set<string>()
      let failResolution = true
      const plugin: Plugin = {
        name: 'mokup-test-resolution-retry',
        enforce: 'pre',
        resolveId(source) {
          if (cleanId(source) !== normalizePath(requested)) {
            return null
          }
          attemptedIds.add(source)
          if (failResolution) {
            throw new Error('fixture resolution failed')
          }
          return `${normalizePath(target)}${querySuffix(source)}`
        },
      }
      await fs.writeFile(stable, 'export const value = "stable"\n')
      await fs.writeFile(target, 'export const value: number = 1\n')
      const server = await createServer({ plugins: [plugin] })
      expect((await loadModuleWithVite(server, stable))?.value).toBe('stable')
      const stableIds = moduleIds(server, stable)
      await expect(loadModuleWithVite(server, requested)).rejects.toThrow('fixture resolution failed')

      failResolution = false
      expect((await loadModuleWithVite(server, requested))?.value).toBe(1)
      const recoveredIds = moduleIds(server, target)
      expect(attemptedIds.size).toBe(2)
      expect(recoveredIds).toHaveLength(1)

      await fs.writeFile(target, 'throw new Error("fixture evaluation failed")\n')
      await expect(loadModuleWithVite(server, requested)).rejects.toThrow('fixture evaluation failed')
      await fs.writeFile(target, 'export const value: number = 2\n')
      expect((await loadModuleWithVite(server, requested))?.value).toBe(2)
      expect(moduleIds(server, target)).toEqual(recoveredIds)
      expect(attemptedIds.size).toBe(2)
      expect((await loadModuleWithVite(server, stable))?.value).toBe('stable')
      expect(moduleIds(server, stable)).toEqual(stableIds)
    })
  })

  it('keeps different servers and their transforms isolated for the same physical file', async () => {
    await withViteFixture(async ({ root, createServer }) => {
      const file = path.join(root, 'shared.ts')
      const plugin = (label: string): Plugin => ({
        name: `mokup-test-${label}`,
        transform(code, id) {
          if (cleanId(id) === normalizePath(file)) {
            return `${code}\nexport const server = ${JSON.stringify(label)}\n`
          }
          return null
        },
      })
      await fs.writeFile(file, 'export const value: number = 1\n')
      const first = await createServer({ plugins: [plugin('first')] })
      const second = await createServer({ plugins: [plugin('second')] })
      expect(await loadModuleWithVite(first, file)).toMatchObject({ value: 1, server: 'first' })
      expect(await loadModuleWithVite(second, file)).toMatchObject({ value: 1, server: 'second' })
      const firstIds = moduleIds(first, file)
      const secondIds = moduleIds(second, file)
      expect(firstIds).toHaveLength(1)
      expect(secondIds).toHaveLength(1)
      expect(firstIds).not.toEqual(secondIds)

      await fs.writeFile(file, 'export const value: number = 2\n')
      expect(await loadModuleWithVite(second, file)).toMatchObject({ value: 2, server: 'second' })
      expect(await loadModuleWithVite(first, file)).toMatchObject({ value: 2, server: 'first' })
      expect(moduleIds(first, file)).toEqual(firstIds)
      expect(moduleIds(second, file)).toEqual(secondIds)
    })
  })

  it('uses a new entry identity after the same Vite server restarts', async () => {
    await withViteFixture(async ({ root, createServer }) => {
      const file = path.join(root, 'restart.ts')
      const server = await createServer()
      await fs.writeFile(file, 'export const value: number = 1\n')
      expect((await loadModuleWithVite(server, file))?.value).toBe(1)
      const previousGraph = server.moduleGraph
      const previousIds = moduleIds(server, file)

      await server.restart()
      await fs.writeFile(file, 'export const value: number = 2\n')
      expect((await loadModuleWithVite(server, file))?.value).toBe(2)
      expect(server.moduleGraph).not.toBe(previousGraph)
      expect(moduleIds(server, file)).toHaveLength(1)
      expect(moduleIds(server, file)).not.toEqual(previousIds)
      expect(server.httpServer).toBeNull()
      expect(server.watcher.getWatched()).toEqual({})
    })
  })

  it('propagates an ordinary SSR evaluation error without replacing it', async () => {
    await withViteFixture(async ({ root, createServer }) => {
      const file = path.join(root, 'error.ts')
      const helper = path.join(root, 'failure.ts')
      await fs.writeFile(helper, 'export const failure = new Error("ordinary fixture failure")\n')
      await fs.writeFile(file, 'import { failure } from "./failure.ts"; throw failure\n')
      const server = await createServer()
      const failure = (await server.ssrLoadModule(normalizePath(helper)))['failure']

      await expect(loadModuleWithVite(server, file)).rejects.toBe(failure)
      await expect(loadModuleWithVite(server, file)).rejects.toBe(failure)
      expect(moduleIds(server, file)).toHaveLength(1)
    })
  })

  it('falls back to native loading when the real SSR transform reports a disconnected transport', async () => {
    await withViteFixture(async ({ root, createServer }) => {
      const file = path.join(root, 'fallback.mjs')
      const transformed: string[] = []
      await fs.writeFile(file, 'export const value = "native fallback"\n')
      const plugin: Plugin = {
        name: 'mokup-test-disconnected-transport',
        transform(_code, id) {
          if (cleanId(id) === normalizePath(file)) {
            transformed.push(id)
            throw new Error('transport was disconnected')
          }
          return null
        },
      }
      const server = await createServer({ plugins: [plugin] })

      expect((await loadModuleWithVite(server, file))?.value).toBe('native fallback')
      expect(transformed).toHaveLength(1)
      expect(moduleIds(server, file)).toHaveLength(1)
    })
  })
})
