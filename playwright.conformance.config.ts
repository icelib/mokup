import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/conformance',
  outputDir: './test-results-conformance',
  timeout: 30_000,
  use: { headless: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
