import { describe, expect, it } from 'vitest'
import { evaluateMigrationGuards } from '../../../scripts/check-migration-guards.mjs'
import { getPackedDependencyViolations, getPackViolations } from '../../../scripts/check-pack-artifacts.mjs'

interface PackageFixture {
  name: string
  type?: string
  private?: boolean
  engines?: { node: string }
  scripts?: Record<string, string>
  exports?: Record<string, unknown>
  dependencies?: Record<string, string>
}

function createLibrary(name: string, node = '>=22.12.0'): PackageFixture {
  return {
    name,
    type: 'module',
    engines: { node },
    scripts: { build: 'tsdown', dev: 'tsdown --watch' },
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.mjs',
        default: './dist/index.mjs',
      },
    },
  }
}

function createInput() {
  return {
    packageEntries: [
      { file: 'packages/runtime/package.json', pkg: createLibrary('@mokup/runtime') },
      {
        file: 'packages/shared/package.json',
        pkg: { ...createLibrary('@mokup/shared'), dependencies: { rolldown: 'catalog:' } },
      },
      {
        file: 'apps/example/package.json',
        pkg: { name: 'example', private: true, engines: { node: '>=24.15.0' } },
      },
    ],
    rootPackage: {
      engines: { node: '>=24.15.0' },
      devDependencies: { tsdown: 'catalog:' },
      pnpm: { overrides: {} as Record<string, string> },
    },
    workspace: {
      catalog: { rolldown: '1.2.14', tsdown: '0.23.1' } as Record<string, string>,
      overrides: {} as Record<string, string>,
    },
    scanEntries: [] as Array<{ file: string, content: string }>,
  }
}

describe('migration guards', () => {
  it('accepts catalog builds with separate development and published Node ranges', () => {
    const input = createInput()
    input.scanEntries.push({
      file: 'packages/example/src/index.ts',
      content: `import { build } from '@mokup/shared/rolldown'\nexport { build }\n`,
    })
    expect(evaluateMigrationGuards(input)).toEqual([])
  })

  it('normalizes Windows package paths before checking the catalog and Node policy sources', () => {
    const input = createInput()
    for (const entry of input.packageEntries) {
      entry.file = entry.file.replaceAll('/', '\\')
    }
    expect(evaluateMigrationGuards(input)).toEqual([])
  })

  it.each([
    {
      location: 'migration documentation',
      file: 'apps\\mokup-docs\\docs\\getting-started\\upgrade-to-v1.md',
      content: `import { build } from '@mokup/shared/esbuild'\nconst { mokup } = require('mokup')\nmodule.exports = mokup({})\n`,
      expected: [],
    },
    {
      location: 'public documentation',
      file: 'apps\\mokup-docs\\docs\\reference\\webpack-plugin.md',
      content: `const { mokupWebpack } = require('mokup/webpack')\nmodule.exports = mokupWebpack({})\n`,
      expected: [
        'apps/mokup-docs/docs/reference/webpack-plugin.md: public docs must use ESM config examples instead of module.exports',
        'apps/mokup-docs/docs/reference/webpack-plugin.md: public docs must use ESM import examples for published mokup packages',
      ],
    },
  ])('checks Windows paths consistently for $location', ({ file, content, expected }) => {
    const input = createInput()
    input.scanEntries.push({ file, content })
    expect(evaluateMigrationGuards(input)).toEqual(expected)
  })

  it('allows catalog and Node policy upgrades without changing guard code', () => {
    const input = createInput()
    input.workspace.catalog = { rolldown: '^2.1.0', tsdown: '^1.2.0' }
    input.rootPackage.engines.node = '>=26.0.0'
    for (const entry of input.packageEntries) {
      entry.pkg.engines = { node: entry.pkg.private ? '>=26.0.0' : '>=22.12.0' }
    }
    expect(evaluateMigrationGuards(input)).toEqual([])
  })

  it('reports runtime and private application Node policy drift', () => {
    const input = createInput()
    input.packageEntries.push(
      { file: 'packages/example/package.json', pkg: createLibrary('@mokup/example', '>=24') },
      { file: 'apps/old/package.json', pkg: { name: 'old', private: true, engines: { node: '>=20' } } },
    )
    expect(evaluateMigrationGuards(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('packages/example/package.json: publishable package engines.node'),
      expect.stringContaining('apps/old/package.json: private package engines.node'),
    ]))
  })

  it('requires valid development and runtime policy sources', () => {
    const input = createInput()
    input.rootPackage.engines.node = '*'
    input.packageEntries = input.packageEntries.filter(entry => entry.file !== 'packages/runtime/package.json')
    expect(evaluateMigrationGuards(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('root engines.node must declare'),
      expect.stringContaining('runtime/package.json: engines.node must declare'),
    ]))
  })

  it.each(['latest', '*', '', 'catalog:', '>2.0.0 <1.0.0'])('rejects unusable catalog version %j', (version) => {
    const input = createInput()
    input.workspace.catalog['rolldown'] = version
    expect(evaluateMigrationGuards(input)).toEqual([
      expect.stringContaining('default catalog.rolldown'),
    ])
  })

  it('rejects missing catalog entries and copied dependency versions', () => {
    const input = createInput()
    delete input.workspace.catalog['tsdown']
    input.rootPackage.devDependencies.tsdown = '^0.23.0'
    input.packageEntries.push({
      file: 'packages/example/package.json',
      pkg: { ...createLibrary('@mokup/example'), dependencies: { rolldown: '^1.2.0' } },
    })
    expect(evaluateMigrationGuards(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('default catalog.tsdown'),
      expect.stringContaining('package.json: devDependencies.tsdown must use "catalog:"'),
      expect.stringContaining('packages/example/package.json: dependencies.rolldown must use "catalog:"'),
    ]))
  })

  it.each(['root', 'workspace'] as const)('rejects blanket Rolldown overrides in %s settings', (location) => {
    const input = createInput()
    const overrides = location === 'root' ? input.rootPackage.pnpm.overrides : input.workspace.overrides
    overrides['rolldown'] = '^1.2.0'
    expect(evaluateMigrationGuards(input)).toEqual([expect.stringContaining('blanket override')])
  })

  it('ignores historical changelog references to legacy tools', () => {
    const input = createInput()
    input.scanEntries.push({
      file: 'packages/example/CHANGELOG.md',
      content: '- Migrated from tsup and unbuild to tsdown.\n',
    })
    expect(evaluateMigrationGuards(input)).toEqual([])
  })

  it('reports legacy build-chain regressions', () => {
    const input = createInput()
    input.packageEntries.push({
      file: 'packages/example/package.json',
      pkg: {
        ...createLibrary('@mokup/example'),
        type: 'commonjs',
        scripts: { build: 'tsup', dev: 'vite' },
        exports: { '.': { require: './dist/index.cjs', default: './dist/index.cjs' } },
        dependencies: { esbuild: '^0.27.0' },
      },
    })
    input.scanEntries.push(
      {
        file: 'packages/example/src/index.ts',
        content: `import { build } from '@mokup/shared/esbuild'\nimport { transform } from 'esbuild'\n`,
      },
      { file: 'packages/example/tsup.config.ts', content: 'export default { tool: "tsup" }\n' },
      {
        file: 'apps/mokup-docs/docs/reference/webpack-plugin.md',
        content: `const { mokupWebpack } = require('mokup/webpack')\nmodule.exports = mokupWebpack({})\n`,
      },
    )
    expect(evaluateMigrationGuards(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('@mokup/shared/esbuild'),
      expect.stringContaining('Direct esbuild imports'),
      expect.stringContaining('Legacy tsup/unbuild'),
      expect.stringContaining('type must be "module"'),
      expect.stringContaining('build script must be "tsdown"'),
      expect.stringContaining('dev script must use "tsdown --watch"'),
      expect.stringContaining('must not depend on esbuild'),
      expect.stringContaining('must not expose a require export condition'),
      expect.stringContaining('must stay ESM-only'),
      expect.stringContaining('public docs must use ESM import examples'),
      expect.stringContaining('public docs must use ESM config examples'),
    ]))
  })
})

describe('packed migration artifacts', () => {
  it('requires the runtime URL matcher dependency even when development installs provide it', () => {
    const pkg = { ...createLibrary('@mokup/runtime'), devDependencies: { '@msw/url': '^0.1.2' } }
    const content = `import { matchPattern } from '@msw/url'; export { matchPattern }`
    expect(getPackedDependencyViolations(pkg, 'dist/session.mjs', content)).toEqual([
      expect.stringContaining('"@msw/url" is not declared in dependencies, optionalDependencies or peerDependencies'),
    ])
    expect(getPackedDependencyViolations({
      ...pkg,
      dependencies: { '@msw/url': '^0.1.2' },
    }, 'dist/session.mjs', content)).toEqual([])
  })

  it('checks lazy imports, reexports and declaration-only dependencies', () => {
    const pkg = createLibrary('@mokup/example')
    expect(getPackedDependencyViolations(pkg, 'dist/index.mjs', `
      export { serve } from '@hono/node-server'
      const socket = await import('ws')
    `)).toEqual([
      expect.stringContaining('imports "@hono/node-server"'),
      expect.stringContaining('imports "ws"'),
    ])
    expect(getPackedDependencyViolations(pkg, 'dist/index.d.ts', `
      import type { Plugin } from 'vite'
      export type * from 'chokidar'
      export type Document = import('graphql').DocumentNode
      import Legacy = require('legacy-types')
    `)).toEqual([
      expect.stringContaining('imports "vite"'),
      expect.stringContaining('imports "chokidar"'),
      expect.stringContaining('imports "graphql"'),
      expect.stringContaining('imports "legacy-types"'),
    ])
  })

  it('checks package resolution and loading through createRequire aliases', () => {
    const pkg = createLibrary('@mokup/core')
    expect(getPackedDependencyViolations(pkg, 'dist/playground/assets.mjs', `
      import { createRequire as makeRequire } from 'node:module'
      import * as nodeModule from 'node:module'
      const load = makeRequire(import.meta.url)
      const require = nodeModule.createRequire(import.meta.url)
      const packagePath = load.resolve('@mokup/playground/package.json')
      const plugin = require('html-webpack-plugin')
      const api = makeRequire(import.meta.url)('tsx/cjs/api')
    `)).toEqual([
      expect.stringContaining('imports "@mokup/playground/package.json"'),
      expect.stringContaining('imports "html-webpack-plugin"'),
      expect.stringContaining('imports "tsx/cjs/api"'),
    ])
  })

  it('accepts declared dependency subpaths, peers, builtins, local files and public self exports', () => {
    const pkg = {
      ...createLibrary('@mokup/example'),
      dependencies: { '@scope/helpers': '^1.0.0' },
      optionalDependencies: { ws: '^8.0.0' },
      peerDependencies: { vite: '^8.0.0' },
      exports: { '.': './dist/index.mjs', './public/*': './dist/public/*.mjs' },
    }
    expect(getPackedDependencyViolations(pkg, 'dist/index.mjs', `
      import { helper } from '@scope/helpers/utils'
      export { defineConfig } from 'vite'
      const socket = await import('ws')
      import fs from 'node:fs'
      import { readFile } from 'fs/promises'
      import './local.mjs'
      import '../other.mjs'
      import '@mokup/example'
      import '@mokup/example/public/http'
    `)).toEqual([])
  })

  it('rejects private self paths and similarly named packages', () => {
    const pkg = {
      ...createLibrary('@mokup/example'),
      exports: { './*': './dist/*.mjs', './internal/*': null },
    }
    expect(getPackedDependencyViolations(pkg, 'dist/index.mjs', `
      import '@mokup/example/internal/helper'
      import '@mokup/example-extra'
    `)).toEqual([
      expect.stringContaining('unexported self reference "@mokup/example/internal/helper"'),
      expect.stringContaining('"@mokup/example-extra" is not declared'),
    ])
  })

  it('ignores generated source strings, comments and nonliteral imports', () => {
    expect(getPackedDependencyViolations(createLibrary('@mokup/runtime'), 'dist/graphql.mjs', `
      const source = "import type { GraphqlOperation } from 'mokup/graphql'"
      // import 'comment-only'
      const generated = \`export * from 'generated-only'\`
      const loaded = await import(modulePath)
      const resolved = require.resolve(packageName + '/package.json')
    `)).toEqual([])
  })

  it('requires every declared export, declaration and CLI entry in the tarball', () => {
    const pkg = {
      ...createLibrary('@mokup/example'),
      bin: { example: './dist/bin.mjs' },
      typesVersions: { '*': { client: ['dist/client.d.ts'] } },
    }
    const files = ['package.json', 'LICENSE', 'dist/index.mjs'].map(path => ({ path }))
    expect(getPackViolations(pkg, files)).toEqual(expect.arrayContaining([
      expect.stringContaining('dist/index.d.ts'),
      expect.stringContaining('dist/bin.mjs'),
      expect.stringContaining('dist/client.d.ts'),
    ]))
    files.push(...['dist/index.d.ts', 'dist/bin.mjs', 'dist/client.d.ts'].map(path => ({ path })))
    expect(getPackViolations(pkg, files)).toEqual([])
  })

  it('requires wildcard exports to match packed files', () => {
    const pkg = { name: '@mokup/example', exports: { './*': './dist/*.mjs' } }
    expect(getPackViolations(pkg, [{ path: 'package.json' }])).toEqual(expect.arrayContaining([
      expect.stringContaining('declared entry "dist/*.mjs"'),
    ]))
    expect(getPackViolations(pkg, [{ path: 'package.json' }, { path: 'dist/index.mjs' }])).toEqual([])
  })

  it('validates playground static assets without requiring library entries', () => {
    const pkg = { name: '@mokup/playground' }
    const html = '<script src="./assets/playground.js"></script><link href="./assets/index.css?v=1">'
    const files = ['package.json', 'dist/index.html', 'dist/assets/playground.js'].map(path => ({ path }))
    expect(getPackViolations(pkg, files, html)).toEqual([
      expect.stringContaining('index.html asset "dist/assets/index.css"'),
    ])
    files.push({ path: 'dist/assets/index.css' })
    expect(getPackViolations(pkg, files, html)).toEqual([])
    expect(getPackViolations(pkg, [], '')).toEqual(expect.arrayContaining([
      expect.stringContaining('tarball must include dist/index.html'),
      expect.stringContaining('tarball must include dist/assets/playground.js'),
    ]))
  })
})
