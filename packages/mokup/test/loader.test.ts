import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadRules } from '@mokup/core'
import { describe, expect, it, vi } from 'vitest'

describe('loadRules json parsing', () => {
  it('accepts json files with comments', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-jsonc-'))
    const file = path.join(root, 'commented.json')
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    try {
      await fs.writeFile(
        file,
        [
          '{',
          '  // allow comments',
          '  "status": "ok"',
          '}',
        ].join('\n'),
        'utf8',
      )

      const rules = await loadRules(file, undefined, logger)
      expect(rules).toHaveLength(1)
      expect(rules[0]?.handler).toEqual({ status: 'ok' })
      expect(logger.warn).not.toHaveBeenCalled()
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('warns on invalid jsonc and returns empty rules', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-jsonc-'))
    const file = path.join(root, 'invalid.jsonc')
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    try {
      await fs.writeFile(
        file,
        [
          '{',
          '  "status": ,',
          '}',
        ].join('\n'),
        'utf8',
      )

      const rules = await loadRules(file, undefined, logger)
      expect(rules).toEqual([])
      expect(logger.warn).toHaveBeenCalled()
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe('loadRules with Vite server', () => {
  it('uses ssrLoadModule and invalidates modules', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-module-'))
    const file = path.join(root, 'rules.js')
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    try {
      await fs.writeFile(file, 'export default { handler: { ok: true } }', 'utf8')
      const moduleNode = { id: file }
      const server = {
        moduleGraph: {
          resolveUrl: vi.fn().mockImplementation(async (id: string) => [id, moduleNode.id]),
          getModuleById: vi.fn().mockReturnValue(moduleNode),
          invalidateModule: vi.fn(),
        },
        ssrLoadModule: vi.fn().mockResolvedValue({ default: { handler: { ok: true } } }),
      }

      const rules = await loadRules(file, server as never, logger)
      expect(rules).toEqual([{ handler: { ok: true } }])
      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(moduleNode)
      expect(server.ssrLoadModule).toHaveBeenCalledWith(server.moduleGraph.resolveUrl.mock.calls[0]?.[0])
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe('loadRules module outputs', () => {
  it('normalizes default exports', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-module-'))
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    try {
      const arrayFile = path.join(root, 'rules-array.js')
      const fnFile = path.join(root, 'rules-fn.js')
      const objFile = path.join(root, 'rules-obj.js')
      const emptyFile = path.join(root, 'rules-empty.js')
      await fs.writeFile(arrayFile, 'export default [{ handler: { ok: true } }]', 'utf8')
      await fs.writeFile(fnFile, 'export default () => ({ ok: true })', 'utf8')
      await fs.writeFile(objFile, 'export default { handler: { ok: true }, status: 201 }', 'utf8')
      await fs.writeFile(emptyFile, 'export {}', 'utf8')

      const arrayRules = await loadRules(arrayFile, undefined, logger)
      expect(arrayRules).toEqual([{ handler: { ok: true } }])

      const fnRules = await loadRules(fnFile, undefined, logger)
      expect(typeof fnRules[0]?.handler).toBe('function')

      const objRules = await loadRules(objFile, undefined, logger)
      expect(objRules).toEqual([{ handler: { ok: true }, status: 201 }])

      const emptyRules = await loadRules(emptyFile, undefined, logger)
      expect(emptyRules).toHaveLength(1)
      expect(Object.keys(emptyRules[0] ?? {})).toHaveLength(0)
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('returns empty rules when json file is missing', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const rules = await loadRules(path.join(tmpdir(), 'missing.json'), undefined, logger)
    expect(rules).toEqual([])
    expect(logger.warn).toHaveBeenCalled()
  })
})
