import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { writeHandlerIndex } from '../src/manifest/handlers'

describe('generated handler index specifiers', () => {
  it('imports apostrophe paths and preserves module map keys including backslashes', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-handler-specifiers-'))
    const handlersDir = path.join(root, 'mokup-handlers')
    const handlerPaths = [
      './mokup-handlers/O\'Brien.get.mjs',
      './mokup-handlers/back\\slash.get.mjs',
    ]
    try {
      await fs.mkdir(path.join(handlersDir, 'back'), { recursive: true })
      for (const modulePath of handlerPaths) {
        const file = path.resolve(root, modulePath.replaceAll('\\', '/'))
        await fs.writeFile(file, `export default ${JSON.stringify(modulePath)}`)
      }
      await writeHandlerIndex(new Map(handlerPaths.map(file => [file, file])), handlersDir, root)

      const { mokupModuleMap } = await import(pathToFileURL(path.join(handlersDir, 'index.mjs')).href)
      expect(Object.keys(mokupModuleMap)).toEqual(handlerPaths)
      for (const modulePath of handlerPaths) {
        expect(mokupModuleMap[modulePath].default).toBe(modulePath)
      }
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
