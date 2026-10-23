import { defineVitestConfig } from 'repoctl/tooling'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => await defineVitestConfig({
  options: {
    includeWorkspaceRootConfig: false,
    coverageExclude: ['**/dist/**'],
    coverageSkipFull: true,
  },
  overrides: {
    test: {
      coverage: {
        thresholds: {
          lines: 85,
          statements: 85,
          functions: 85,
          branches: 75,
        },
      },
      forceRerunTriggers: [
        'package.json',
        'pnpm-workspace.yaml',
        '**/package.json',
        '**/vitest.config.*',
        '**/vite.config.*',
      ],
    },
  },
}))
