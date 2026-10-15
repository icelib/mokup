import { createPlaywrightConfig } from '../../tests/e2e/playwright.base'

export default createPlaywrightConfig({
  testDir: './test/d1',
  overrides: {
    fullyParallel: false,
    workers: 1,
  },
})
