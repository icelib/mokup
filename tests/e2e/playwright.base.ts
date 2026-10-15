import type { PlaywrightTestConfig } from '@playwright/test'
import process from 'node:process'
import { defineConfig } from '@playwright/test'

interface BaseConfigOptions {
  testDir: string
  overrides?: PlaywrightTestConfig
}

export function createPlaywrightConfig(options: BaseConfigOptions) {
  const isCI = Boolean(process.env['CI'])
  const baseURL = process.env['E2E_BASE_URL']
  if (!baseURL) {
    throw new Error('E2E_BASE_URL is required. Run via pnpm test:e2e to provision it.')
  }

  const { overrides } = options

  const baseUse: PlaywrightTestConfig['use'] = {
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  }

  return defineConfig({
    testDir: options.testDir,
    timeout: 60_000,
    expect: {
      timeout: 10_000,
    },
    fullyParallel: true,
    forbidOnly: isCI,
    reporter: [['list']],
    ...overrides,
    use: {
      ...baseUse,
      ...(overrides?.use ?? {}),
    },
  })
}
