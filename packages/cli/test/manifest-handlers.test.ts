import { Buffer } from 'node:buffer'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildResponse,
  bundleHandlers,
  getHandlerModulePath,
  writeHandlerIndex,
} from '../src/manifest/handlers'

const toPosixPath = (value: string) => value.replace(/\\/g, '/')

describe('manifest handler helpers', () => {
  it('builds responses for handler types and records handler modules', () => {
    const root = '/tmp/mokup-handlers'
    const file = path.join(root, 'mock', 'handler.get.ts')
    const handlersDir = path.join(root, '.mokup', 'mokup-handlers')
    const handlerSources = new Set<string>()
    const handlerModuleMap = new Map<string, string>()

    const response = buildResponse(
      () => 'ok',
      {
        file,
        handlers: true,
        handlerSources,
        handlerModuleMap,
        handlersDir,
        root,
        ruleIndex: 2,
      },
    )

    const expectedModule = getHandlerModulePath(file, handlersDir, root)
    expect(response).toEqual({
      type: 'module',
      module: expectedModule,
      ruleIndex: 2,
    })
    expect(handlerSources.has(file)).toBe(true)
    expect(handlerModuleMap.get(file)).toBe(expectedModule)

    expect(buildResponse(
      () => 'skip',
      {
        file,
        handlers: false,
        handlerSources,
        handlerModuleMap,
        handlersDir,
        root,
        ruleIndex: 0,
      },
    )).toBeNull()

    expect(buildResponse(
      'hello',
      {
        file,
        handlers: true,
        handlerSources,
        handlerModuleMap,
        handlersDir,
        root,
        ruleIndex: 0,
      },
    )).toEqual({ type: 'text', body: 'hello' })

    const binary = buildResponse(
      new Uint8Array([1, 2, 3]),
      {
        file,
        handlers: true,
        handlerSources,
        handlerModuleMap,
        handlersDir,
        root,
        ruleIndex: 0,
      },
    )
    expect(binary?.type).toBe('binary')
    expect(binary).toMatchObject({
      body: Buffer.from([1, 2, 3]).toString('base64'),
      encoding: 'base64',
    })

    const originalUint8Array = globalThis.Uint8Array
    vi.stubGlobal('Uint8Array', class {} as typeof Uint8Array)
    try {
      const bufferResponse = buildResponse(
        Buffer.from('ok'),
        {
          file,
          handlers: true,
          handlerSources,
          handlerModuleMap,
          handlersDir,
          root,
          ruleIndex: 0,
        },
      )
      expect(bufferResponse?.type).toBe('binary')
    }
    finally {
      vi.stubGlobal('Uint8Array', originalUint8Array)
    }

    const jsonResponse = buildResponse(
      { ok: true },
      {
        file,
        handlers: true,
        handlerSources,
        handlerModuleMap,
        handlersDir,
        root,
        ruleIndex: 0,
      },
    )
    expect(jsonResponse).toEqual({ type: 'json', body: { ok: true } })
  })

  it('writes handler index with unique module imports', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-handlers-'))
    const outDir = path.join(root, 'dist')
    const handlersDir = path.join(outDir, 'mokup-handlers')
    const handlerModuleMap = new Map<string, string>()
    try {
      await fs.mkdir(handlersDir, { recursive: true })
      handlerModuleMap.set('/file/a', './mokup-handlers/mock/handler.mjs')
      handlerModuleMap.set('/file/b', './mokup-handlers/mock/handler.mjs')

      await writeHandlerIndex(handlerModuleMap, handlersDir, outDir)

      const indexContent = await fs.readFile(path.join(handlersDir, 'index.mjs'), 'utf8')
      expect(indexContent.match(/import \* as module/g)?.length).toBe(1)
      expect(indexContent).toContain('mokupModuleMap')

      const dts = await fs.readFile(path.join(handlersDir, 'index.d.ts'), 'utf8')
      expect(dts).toContain('ModuleMap')
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('writes handler index imports for paths outside handlers dir', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-handlers-external-'))
    const outDir = path.join(root, 'dist')
    const handlersDir = path.join(outDir, 'mokup-handlers')
    const handlerModuleMap = new Map<string, string>()
    try {
      await fs.mkdir(handlersDir, { recursive: true })
      const modulePath = '../external/handler.mjs'
      handlerModuleMap.set('/file/a', modulePath)

      await writeHandlerIndex(handlerModuleMap, handlersDir, outDir)

      const indexContent = await fs.readFile(path.join(handlersDir, 'index.mjs'), 'utf8')
      const relImport = path.relative(handlersDir, path.resolve(outDir, modulePath))
      const importPath = relImport.startsWith('.') ? relImport : `./${relImport}`
      expect(indexContent).toContain(`import * as module0 from ${JSON.stringify(toPosixPath(importPath))}`)
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('skips index generation when no handler modules exist', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-handlers-empty-'))
    const handlersDir = path.join(root, 'mokup-handlers')
    try {
      await fs.mkdir(handlersDir, { recursive: true })
      await writeHandlerIndex(new Map(), handlersDir, root)
      await expect(fs.stat(path.join(handlersDir, 'index.mjs'))).rejects.toBeDefined()
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('returns relative paths when handlersDir is outside the output root', () => {
    const root = '/tmp/mokup-handlers'
    const file = path.join(root, 'mock', 'handler.get.ts')
    const handlersDir = `${root}/handlers/..`
    const modulePath = getHandlerModulePath(file, handlersDir, root)
    expect(modulePath.startsWith('..')).toBe(true)
  })

  it('normalizes dynamic handler file names to match bundler output', () => {
    const root = '/tmp/mokup-handlers'
    const file = path.join(root, 'mock', 'docs', '[[...slug]].get.ts')
    const handlersDir = path.join(root, '.mokup', 'mokup-handlers')
    const modulePath = getHandlerModulePath(file, handlersDir, root)

    expect(modulePath).toBe('./mokup-handlers/mock/docs/__...slug__.get.mjs')
  })

  it('treats Buffer as binary when Uint8Array checks are unavailable', () => {
    const root = '/tmp/mokup-handlers'
    const file = path.join(root, 'mock', 'handler.get.ts')
    const handlersDir = path.join(root, '.mokup', 'mokup-handlers')
    const handlerSources = new Set<string>()
    const handlerModuleMap = new Map<string, string>()
    const originalUint8Array = globalThis.Uint8Array
    const originalArrayBuffer = globalThis.ArrayBuffer

    vi.stubGlobal('Uint8Array', class {} as typeof Uint8Array)
    vi.stubGlobal('ArrayBuffer', class {} as typeof ArrayBuffer)
    try {
      const response = buildResponse(
        Buffer.from('ok'),
        {
          file,
          handlers: true,
          handlerSources,
          handlerModuleMap,
          handlersDir,
          root,
          ruleIndex: 0,
        },
      )
      expect(response).toMatchObject({ type: 'binary', encoding: 'base64' })
    }
    finally {
      vi.stubGlobal('Uint8Array', originalUint8Array)
      vi.stubGlobal('ArrayBuffer', originalArrayBuffer)
    }
  })

  it('writes a package manifest so handler chunks load as ESM', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-handlers-package-'))
    const entryFile = path.join(root, 'mock', 'login.post.ts')
    const handlersDir = path.join(root, 'dist', 'mokup-handlers')
    try {
      await fs.mkdir(path.dirname(entryFile), { recursive: true })
      await fs.writeFile(entryFile, 'export default () => ({ ok: true })\n', 'utf8')

      await fs.mkdir(handlersDir, { recursive: true })
      await bundleHandlers([entryFile], root, handlersDir)

      const packageJson = await fs.readFile(path.join(handlersDir, 'package.json'), 'utf8')
      expect(JSON.parse(packageJson)).toEqual({ type: 'module' })
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
