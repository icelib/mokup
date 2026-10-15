import { describe, expect, it } from 'vitest'
import { evaluateMigrationGuards } from '../../../scripts/check-migration-guards.mjs'

describe('migration guards', () => {
  it('accepts rolldown and tsdown aligned package metadata', () => {
    const violations = evaluateMigrationGuards({
      packageEntries: [
        {
          file: 'packages/shared/package.json',
          pkg: {
            name: '@mokup/shared',
            type: 'module',
            private: false,
            dependencies: {
              rolldown: '1.2.14',
            },
            engines: {
              node: '>=22.12.0',
            },
            scripts: {
              build: 'tsdown',
              dev: 'tsdown --watch',
            },
            exports: {
              '.': {
                types: './dist/index.d.ts',
                import: './dist/index.mjs',
                default: './dist/index.mjs',
              },
            },
          },
        },
        {
          file: 'apps/example/package.json',
          pkg: {
            private: true,
            engines: {
              node: '^24.11.0 || >=26.0.0',
            },
          },
        },
      ],
      rootPackage: {
        engines: {
          node: '^24.11.0 || >=26.0.0',
        },
      },
      scanEntries: [
        {
          file: 'packages/example/src/index.ts',
          content: `import { build } from '@mokup/shared/rolldown'\nexport { build }\n`,
        },
        {
          file: 'apps/mokup-docs/docs/reference/webpack-plugin.md',
          content: `import { mokupWebpack } from 'mokup/webpack'\nexport default mokupWebpack({})\n`,
        },
      ],
      workspaceConfig: {
        catalogs: {
          default: {
            rolldown: '1.2.14',
          },
        },
        overrides: {
          rolldown: '1.2.14',
        },
      },
    })

    expect(violations).toEqual([])
  })

  it('ignores historical changelog references to legacy tools', () => {
    const violations = evaluateMigrationGuards({
      packageEntries: [],
      rootPackage: {
        engines: {
          node: '^24.11.0 || >=26.0.0',
        },
      },
      scanEntries: [
        {
          file: 'packages/example/CHANGELOG.md',
          content: '- Migrated from tsup and unbuild to tsdown.\n',
        },
      ],
      workspaceConfig: {
        catalogs: {
          default: {
            rolldown: '1.2.14',
          },
        },
        overrides: {
          rolldown: '1.2.14',
        },
      },
    })

    expect(violations).toEqual([])
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
    const violations = evaluateMigrationGuards({
      packageEntries: [],
      rootPackage: {
        engines: {
          node: '^24.11.0 || >=26.0.0',
        },
      },
      scanEntries: [{ file, content }],
      workspaceConfig: {
        catalogs: {
          default: {
            rolldown: '1.2.14',
          },
        },
        overrides: {
          rolldown: '1.2.14',
        },
      },
    })

    expect(violations).toEqual(expected)
  })

  it('keeps published runtime requirements separate from development requirements', () => {
    const violations = evaluateMigrationGuards({
      packageEntries: [
        {
          file: 'packages/example/package.json',
          pkg: {
            type: 'module',
            engines: {
              node: '^24.11.0 || >=26.0.0',
            },
          },
        },
        {
          file: 'apps/example/package.json',
          pkg: {
            private: true,
            engines: {
              node: '>=22.12.0',
            },
          },
        },
      ],
      rootPackage: {
        engines: {
          node: '>=22.12.0',
        },
      },
      scanEntries: [],
      workspaceConfig: {
        catalogs: {
          default: {
            rolldown: '1.2.14',
          },
        },
        overrides: {
          rolldown: '1.2.14',
        },
      },
    })

    expect(violations).toEqual([
      'apps/example/package.json: app engines.node must be "^24.11.0 || >=26.0.0"',
      'package.json: root engines.node must be "^24.11.0 || >=26.0.0"',
      'packages/example/package.json: publishable package engines.node must be ">=22.12.0"',
    ])
  })

  it.each([
    {
      location: 'catalog range',
      catalog: '^1.2.14',
      dependency: '1.2.14',
      override: '1.2.14',
      expected: 'pnpm-workspace.yaml: catalogs.default.rolldown must stay pinned to "1.2.14"',
    },
    {
      location: 'missing catalog',
      catalog: undefined,
      dependency: '1.2.14',
      override: '1.2.14',
      expected: 'pnpm-workspace.yaml: catalogs.default.rolldown must stay pinned to "1.2.14"',
    },
    {
      location: 'runtime dependency range',
      catalog: '1.2.14',
      dependency: '^1.2.14',
      override: '1.2.14',
      expected: 'packages/shared/package.json: dependencies.rolldown must stay pinned to "1.2.14"',
    },
    {
      location: 'missing runtime dependency',
      catalog: '1.2.14',
      dependency: undefined,
      override: '1.2.14',
      expected: 'packages/shared/package.json: dependencies.rolldown must stay pinned to "1.2.14"',
    },
    {
      location: 'override version',
      catalog: '1.2.14',
      dependency: '1.2.14',
      override: '1.2.0',
      expected: 'pnpm-workspace.yaml: overrides.rolldown must stay pinned to "1.2.14"',
    },
  ])('rejects Rolldown drift in $location', ({ catalog, dependency, override, expected }) => {
    const violations = evaluateMigrationGuards({
      packageEntries: [
        {
          file: 'packages/shared/package.json',
          pkg: {
            type: 'module',
            engines: {
              node: '>=22.12.0',
            },
            dependencies: {
              rolldown: dependency,
            },
          },
        },
      ],
      rootPackage: {
        engines: {
          node: '^24.11.0 || >=26.0.0',
        },
      },
      scanEntries: [],
      workspaceConfig: {
        catalogs: {
          default: {
            rolldown: catalog,
          },
        },
        overrides: {
          rolldown: override,
        },
      },
    })

    expect(violations).toEqual([expected])
  })

  it('reports legacy build-chain regressions', () => {
    const violations = evaluateMigrationGuards({
      packageEntries: [
        {
          file: 'packages/example/package.json',
          pkg: {
            name: '@mokup/example',
            type: 'commonjs',
            private: false,
            engines: {
              node: '>=20',
            },
            scripts: {
              build: 'tsup',
              dev: 'vite',
            },
            exports: {
              '.': {
                require: './dist/index.cjs',
                default: './dist/index.cjs',
              },
            },
            dependencies: {
              esbuild: '^0.27.0',
            },
          },
        },
      ],
      rootPackage: {
        engines: {
          node: '>=20',
        },
      },
      scanEntries: [
        {
          file: 'packages/example/src/index.ts',
          content: `import { build } from '@mokup/shared/esbuild'\nimport { transform } from 'esbuild'\n`,
        },
        {
          file: 'packages/example/tsup.config.ts',
          content: `export default {
  tool: 'tsup',
}
`,
        },
        {
          file: 'apps/mokup-docs/docs/reference/webpack-plugin.md',
          content: `const { mokupWebpack } = require('mokup/webpack')\nmodule.exports = mokupWebpack({})\n`,
        },
      ],
      workspaceConfig: {
        catalogs: {
          default: {
            rolldown: '1.2.14',
          },
        },
        overrides: {
          rolldown: '1.0.0-beta.1',
        },
      },
    })

    expect(violations).toEqual(
      expect.arrayContaining([
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
        expect.stringContaining('root engines.node'),
        expect.stringContaining('overrides.rolldown'),
      ]),
    )
  })
})
