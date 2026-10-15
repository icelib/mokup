import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadModule, loadModuleWithVite } from '@mokup/core'
import { describe, expect, it, vi } from 'vitest'

async function createTempModule(name: string, content: string) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'mokup-module-'))
  const file = join(dir, name)
  await fs.writeFile(file, content, 'utf8')
  return { dir, file }
}

describe('module loader', () => {
  it('loads cjs, js, mjs, and ts modules', async () => {
    const cjs = await createTempModule('value.cjs', 'module.exports = { value: "cjs" }')
    const js = await createTempModule('value.js', 'export const value = "js"')
    const mjs = await createTempModule('value.mjs', 'export const value = "mjs"')
    const ts = await createTempModule('value.ts', 'export const value = "ts"')

    try {
      const cjsMod = await loadModule(cjs.file)
      const jsMod = await loadModule(js.file)
      const mjsMod = await loadModule(mjs.file)
      const tsMod = await loadModule(ts.file)

      expect(cjsMod?.value).toBe('cjs')
      expect(jsMod?.value).toBe('js')
      expect(mjsMod?.value).toBe('mjs')
      expect(tsMod?.value).toBe('ts')
    }
    finally {
      await fs.rm(cjs.dir, { recursive: true, force: true })
      await fs.rm(js.dir, { recursive: true, force: true })
      await fs.rm(mjs.dir, { recursive: true, force: true })
      await fs.rm(ts.dir, { recursive: true, force: true })
    }
  })

  it('uses Vite ssrLoadModule when available', async () => {
    const node = { id: '/mock.ts', file: '/mock.ts' }
    const server = {
      moduleGraph: {
        resolveUrl: vi.fn().mockImplementation(async (id: string) => [id, node.id]),
        getModuleById: vi.fn().mockReturnValue(node),
        getModulesByFile: vi.fn().mockReturnValue(undefined),
        invalidateModule: vi.fn(),
      },
      ssrLoadModule: vi.fn().mockResolvedValue({ value: 'ssr' }),
    }

    const mod = await loadModuleWithVite(server as never, '/mock.ts')
    expect(mod).toEqual({ value: 'ssr' })
    expect(server.moduleGraph.invalidateModule).toHaveBeenCalled()
    expect(server.moduleGraph.resolveUrl).toHaveBeenCalledWith(expect.stringMatching(/^\/mock\.ts\?mokupv=.+$/), true)
    expect(server.ssrLoadModule).toHaveBeenCalledWith(server.moduleGraph.resolveUrl.mock.calls[0]?.[0])
  })

  it('invalidates all module nodes resolved by file', async () => {
    const nodeA = { id: '/mock.ts?import' }
    const nodeB = { id: '/mock.ts?ssr' }
    const server = {
      moduleGraph: {
        resolveUrl: vi.fn().mockImplementation(async (id: string) => [id, nodeB.id]),
        getModuleById: vi.fn().mockReturnValue(null),
        getModulesByFile: vi.fn().mockReturnValue(new Set([nodeA, nodeB])),
        invalidateModule: vi.fn(),
      },
      ssrLoadModule: vi.fn().mockResolvedValue({ value: 'ssr' }),
    }

    const mod = await loadModuleWithVite(server as never, '/mock.ts')
    expect(mod).toEqual({ value: 'ssr' })
    expect(server.moduleGraph.getModulesByFile).toHaveBeenCalledWith('/mock.ts')
    expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(nodeA)
    expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(nodeB)
    expect(server.moduleGraph.invalidateModule).toHaveBeenCalledTimes(2)
    expect(server.ssrLoadModule).toHaveBeenCalledWith(server.moduleGraph.resolveUrl.mock.calls[0]?.[0])
  })

  it('falls back to loadModule without Vite', async () => {
    const js = await createTempModule('value.js', 'export const value = "fallback"')
    try {
      const mod = await loadModuleWithVite({} as never, js.file)
      expect(mod?.value).toBe('fallback')
    }
    finally {
      await fs.rm(js.dir, { recursive: true, force: true })
    }
  })
})
