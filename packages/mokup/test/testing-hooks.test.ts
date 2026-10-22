import type { MockHooks } from '../src/testing/hooks'
import { describe, expect, it, vi } from 'vitest'
import { registerMockHooks } from '../src/testing/hooks'

function hooks() {
  const registered = { beforeAll: [] as Array<() => void | Promise<void>>, afterEach: [] as Array<() => void | Promise<void>>, afterAll: [] as Array<() => void | Promise<void>> }
  const api: MockHooks = {
    beforeAll: callback => registered.beforeAll.push(callback),
    afterEach: callback => registered.afterEach.push(callback),
    afterAll: callback => registered.afterAll.push(callback),
  }
  return { registered, api }
}

describe('framework-independent lifecycle hooks', () => {
  it('registers and awaits startup, reset and cleanup without importing a framework', async () => {
    const { api, registered } = hooks()
    const order: string[] = []
    registerMockHooks(api, {
      start: async () => {
        await Promise.resolve()
        order.push('start')
      },
      reset: () => { order.push('reset') },
      stop: async () => {
        await Promise.resolve()
        order.push('stop')
      },
    })
    expect(order).toEqual([])
    await registered.beforeAll[0]!()
    await registered.afterEach[0]!()
    await registered.afterAll[0]!()
    expect(order).toEqual(['start', 'reset', 'stop'])
  })

  it('allows reset opt-out and cleans up failed startup', async () => {
    const { api, registered } = hooks()
    const stop = vi.fn()
    registerMockHooks(api, {
      start: () => { throw new Error('startup') },
      reset: vi.fn(),
      stop,
    }, { resetAfterEach: false })
    expect(registered.afterEach).toEqual([])
    await expect(registered.beforeAll[0]!()).rejects.toThrow('startup')
    expect(stop).toHaveBeenCalledOnce()
  })

  it('reports both startup and cleanup failure', async () => {
    const { api, registered } = hooks()
    registerMockHooks(api, {
      start: () => { throw new Error('startup') },
      reset: vi.fn(),
      stop: () => { throw new Error('cleanup') },
    })
    await expect(registered.beforeAll[0]!()).rejects.toMatchObject({ errors: [new Error('startup'), new Error('cleanup')] })
  })
})
