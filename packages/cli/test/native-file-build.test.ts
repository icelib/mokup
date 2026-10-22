import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRuntime } from '@mokup/runtime'
import { describe, expect, it } from 'vitest'
import { buildManifest, checkManifest } from '../src/index'

describe('native file build artifacts', () => {
  it('preserves once, array indexes and generator modules without invoking resolvers at build time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-native-build-'))
    const mock = join(root, 'mock')
    let runtime: ReturnType<typeof createRuntime> | undefined
    try {
      await mkdir(join(mock, 'users'), { recursive: true })
      const api = fileURLToPath(new URL('../../runtime/dist/http.mjs', import.meta.url))
      await writeFile(join(mock, 'users', '[id].get.ts'), `
        import { defineHttpHandler, HttpResponse } from ${JSON.stringify(api)}
        export default [
          defineHttpHandler(({ params }) => HttpResponse.json({ id: params.id, mode: 'once' }), { once: true, status: 201 }),
          defineHttpHandler(function* ({ params }) {
            yield HttpResponse.json({ id: params.id, mode: 'first' })
            return HttpResponse.json({ id: params.id, mode: 'last' })
          }, { headers: { 'x-rule': 'sequence' } }),
          { handler: (c) => c.json({ id: c.req.param('id'), mode: 'legacy' }) },
        ]
      `)
      await writeFile(join(mock, 'index.config.ts'), `export default {
        middleware: async (c, next) => {
          await next()
          c.header('x-directory', 'yes')
        }
      }`)
      expect(await checkManifest({ root, dir: 'mock' })).toMatchObject({ valid: true, routeCount: 3, diagnostics: [] })
      const built = await buildManifest({ root, dir: 'mock', outDir: 'dist' })
      expect(built.manifest.routes.map(route => ({ handlerType: route.handlerType, once: route.once, response: route.response }))).toEqual([
        { handlerType: 'http', once: true, response: { type: 'module', module: './mokup-handlers/mock/users/_id_.get.mjs', ruleIndex: 0 } },
        { handlerType: 'http', once: undefined, response: { type: 'module', module: './mokup-handlers/mock/users/_id_.get.mjs', ruleIndex: 1 } },
        { handlerType: undefined, once: undefined, response: { type: 'module', module: './mokup-handlers/mock/users/_id_.get.mjs', ruleIndex: 2 } },
      ])
      const bundle = await import(pathToFileURL(join(root, 'dist', 'mokup.bundle.mjs')).href)
      runtime = createRuntime(bundle.default)
      for (const mode of ['once', 'first', 'last', 'legacy']) {
        const response = await runtime.fetch(new Request('https://example.test/users/42'))
        expect(response?.status).toBe(mode === 'once' ? 201 : 200)
        expect(response?.headers.get('x-directory')).toBe('yes')
        expect(response?.headers.get('x-rule')).toBe(['first', 'last'].includes(mode) ? 'sequence' : null)
        expect(await response?.json()).toEqual({ id: '42', mode })
      }
      runtime.restoreHandlers()
      expect(await (await runtime.fetch(new Request('https://example.test/users/99')))?.json()).toEqual({ id: '99', mode: 'once' })
      const staticOnly = await buildManifest({ root, dir: 'mock', outDir: 'static', handlers: false })
      expect(staticOnly.manifest.routes).toEqual([])
    }
    finally {
      await runtime?.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports invalid native file metadata through strict route checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-native-invalid-'))
    try {
      await mkdir(join(root, 'mock'))
      await writeFile(join(root, 'mock', 'bad.get.ts'), 'export default { handlerType: \'http\', handler: { body: \'invalid\' } }')
      const report = await checkManifest({ root, dir: 'mock' })
      expect(report.valid).toBe(false)
      expect(report.routeCount).toBe(0)
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
