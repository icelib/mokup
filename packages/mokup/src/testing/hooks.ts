export interface MockHooks {
  beforeAll: (callback: () => void | Promise<void>) => unknown
  afterEach: (callback: () => void | Promise<void>) => unknown
  afterAll: (callback: () => void | Promise<void>) => unknown
}

/** Supply closures so this helper does not depend on a test framework or transport. */
export interface MockLifecycle {
  start: () => void | Promise<void>
  reset: () => void | Promise<void>
  stop: () => void | Promise<void>
}

export interface MockLifecycleOptions {
  resetAfterEach?: boolean
}

/** Register awaited lifecycle callbacks with caller-provided Vitest/Jest-style hooks. */
export function registerMockHooks(hooks: MockHooks, lifecycle: MockLifecycle, options: MockLifecycleOptions = {}): void {
  hooks.beforeAll(async () => {
    try {
      await lifecycle.start()
    }
    catch (error) {
      try {
        await lifecycle.stop()
      }
      catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Mock startup and cleanup both failed.')
      }
      throw error
    }
  })
  if (options.resetAfterEach !== false) {
    hooks.afterEach(async () => {
      await lifecycle.reset()
    })
  }
  hooks.afterAll(async () => {
    await lifecycle.stop()
  })
}
