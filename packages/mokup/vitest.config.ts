import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Core unit tests and mocks must share the source modules used by coverage.
    alias: [
      { find: /^@mokup\/core$/, replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
      { find: /^@mokup\/core\/(.+)$/, replacement: `${fileURLToPath(new URL('../core/src/', import.meta.url))}$1.ts` },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
