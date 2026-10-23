import { defineMonorepoConfig } from 'repoctl'

const documentationPackages = {
  'mokup': 'packages/mokup',
  '@mokup/cli': 'packages/cli',
  '@mokup/client': 'packages/client',
  '@mokup/core': 'packages/core',
  '@mokup/msw': 'packages/msw',
  '@mokup/playground': 'packages/playground',
  '@mokup/query': 'packages/query',
  '@mokup/runtime': 'packages/runtime',
  '@mokup/server': 'packages/server',
  '@mokup/shared': 'packages/shared',
}
const releaseInputs = Object.fromEntries(Object.entries(documentationPackages).map(([name, directory]) => [name, [
  `${directory}/**`,
  'tsconfig.json',
  ...(name === '@mokup/playground' ? ['packages/runtime/src/**'] : ['scripts/tsdown-config.ts']),
  '!**/README*',
  '!**/CHANGELOG*',
  '!**/docs/**',
  '!**/test/**',
  '!**/tests/**',
  '!**/__tests__/**',
  '!**/test-d/**',
  '!**/fixtures/**',
  '!**/*.test.*',
  '!**/*.spec.*',
]]))

export default defineMonorepoConfig({
  commands: {
    docs: {
      sites: {
        website: {
          packages: Object.keys(documentationPackages),
          releaseInputs,
          buildScript: 'docs:build',
          preview: { deployScript: 'docs:deploy:preview', url: 'https://next.mokup.icebreaker.top' },
          stable: { deployScript: 'docs:deploy:stable', url: 'https://mokup.icebreaker.top' },
          patchPaths: [
            'apps/mokup-docs/docs/**/*.md',
            'apps/mokup-docs/docs/public/**/*.{png,jpg,jpeg,webp,svg}',
          ],
        },
      },
    },
    create: {
      defaultTemplate: 'tsdown',
      renameJson: false,
    },
    clean: {
      autoConfirm: false,
      includePrivate: true,
    },
    release: {
      nightly: { provider: 'npm', schedule: '17 19 * * *' },
      // Nightly gives each command 10 minutes; retain every release:check gate in bounded stages.
      qualityScripts: ['release:check:build', 'release:check:quality', 'release:check:runtime'],
      hooks: {
        afterPublish: [{ script: 'release:sync-npmmirror', continueOnError: true, idempotent: true }],
      },
    },
    upgrade: {
      skipOverwrite: false,
      // Keep application-specific assets outside root template synchronization.
      mergeTargets: false,
      targets: [
        '.github/workflows/ci.yml',
        '.github/workflows/release.yml',
        '.github/workflows/repoctl-docs.yml',
        '.github/workflows/repoctl-docs-deploy.yml',
        'AGENTS.md',
        'CONTRIBUTING.md',
        'commitlint.config.ts',
        'eslint.config.js',
        'lefthook.yml',
        'package.json',
        'pnpm-workspace.yaml',
        'repoctl.config.ts',
        'stylelint.config.js',
        'tsconfig.json',
        'turbo.json',
        'vitest.config.ts',
      ],
    },
  },
})
