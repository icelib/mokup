import type { Manifest } from '@mokup/runtime'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { buildBundleModule } from '../src/bundle'
import { injectPlaygroundHmr } from '../src/playground/inject'
import { buildSwScript } from '../src/sw'

function evaluateModule(source: string) {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module'], {
    input: `
      import { setImmediate } from 'node:timers/promises'
      import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
      const imports = []
      const context = createContext({ self: { addEventListener() {} } })
      function link(specifier) {
        imports.push(specifier)
        return new SyntheticModule(['default', 'createLogger', 'createRuntimeApp', 'handle', 'createHotContext'], function () {
          this.setExport('default', () => specifier)
          this.setExport('createLogger', () => ({ error() {} }))
          this.setExport('createRuntimeApp', async () => ({ fetch() {} }))
          this.setExport('handle', () => () => {})
          this.setExport('createHotContext', () => ({ on() {}, dispose() {} }))
        }, { context })
      }
      const entry = new SourceTextModule(${JSON.stringify(source)}, {
        context,
        async importModuleDynamically(specifier) {
          const module = link(specifier)
          await module.link(() => {})
          await module.evaluate()
          return module
        },
      })
      await entry.link(link)
      await entry.evaluate()
      await setImmediate()
      process.stdout.write(JSON.stringify({ imports, ...entry.namespace.inspection }))
    `,
    encoding: 'utf8',
  })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as {
    imports: string[]
    manifest: Manifest
    keys: string[]
    linked: string[]
  }
}

const unusualPaths = [
  '/mock/O\'Brien.get.ts',
  '/mock/quoted"path.get.ts',
  '/mock/back\\slash.get.ts',
  '/mock/new\nline.get.ts',
]

describe.each([
  ['bundle', buildBundleModule],
  ['Service Worker', buildSwScript],
] as const)('%s module specifiers', (_name, build) => {
  it.each(unusualPaths)('preserves module identity for %j', (modulePath) => {
    const middlewarePath = `${modulePath}.middleware`
    const source = build({
      root: '/project',
      routes: [{
        file: modulePath,
        method: 'GET',
        template: '/hello',
        tokens: [],
        score: [],
        handler: () => 'hello',
        middlewares: [{ source: middlewarePath, index: 0, position: 'normal', handle: async () => undefined }],
      }],
      resolveModulePath: file => file,
    })
    const result = evaluateModule(`${source}
      export const inspection = {
        manifest,
        keys: Object.keys(moduleMap),
        linked: Object.values(moduleMap).map(entry => typeof entry.default === 'function'
          ? entry.default() : entry.default[0].handler()),
      }
    `)
    expect(result.imports.slice(-2)).toEqual([modulePath, middlewarePath])
    expect(result.keys).toEqual([modulePath, middlewarePath])
    expect(result.linked).toEqual([modulePath, middlewarePath])
    expect(result.manifest.routes[0]?.response).toEqual({ type: 'module', module: modulePath })
    expect(result.manifest.routes[0]?.middleware).toEqual([{ module: middlewarePath, ruleIndex: 0 }])
  })
})

it.each(unusualPaths)('preserves the HMR client module path under base %j', (base) => {
  const html = injectPlaygroundHmr('', base)
  const source = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'))
  expect(evaluateModule(source).imports).toEqual([`${base}/@vite/client`])
})
