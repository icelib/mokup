import { describe, expect, it } from 'vitest'
import { createMemoryStore, createScenario, createScenarioCatalog } from '../src/scenario'

describe('isolated seeded scenarios', () => {
  it('reproduces sequences and restores both data and PRNG position', () => {
    const first = createScenario('checkout', { cart: ['apple'] })
    const second = createScenario('checkout', { cart: ['apple'] })
    expect(Array.from({ length: 10 }, () => first.integer(-10, 10)))
      .toEqual(Array.from({ length: 10 }, () => second.integer(-10, 10)))
    const snapshot = first.snapshot()
    const next = first.random()
    first.update(state => state.cart.push('orange'))
    first.restore(snapshot)
    expect(first.random()).toBe(next)
    expect(first.getState()).toEqual({ cart: ['apple'] })
    snapshot.state.cart.push('external')
    expect(first.getState()).toEqual({ cart: ['apple'] })
    first.reset()
    second.reset()
    expect(first.random()).toBe(second.random())
  })

  it('isolates inputs, reads, writes and concurrent scenario instances', async () => {
    const input = { nested: { count: 0 } }
    const scenarios = Array.from({ length: 100 }, (_, index) => createScenario(index, input))
    input.nested.count = 999
    await Promise.all(scenarios.map(async (scenario, index) => {
      await Promise.resolve()
      scenario.update(state => state.nested.count = index)
      const copy = scenario.getState()
      copy.nested.count = -1
    }))
    expect(scenarios.map(scenario => scenario.getState().nested.count)).toEqual(Array.from({ length: 100 }, (_, i) => i))
    scenarios[0]!.reset()
    expect(scenarios[0]!.getState().nested.count).toBe(0)
  })

  it('rolls back failed updates and rejects asynchronous mutations', async () => {
    const scenario = createScenario(1, { count: 0 })
    expect(() => scenario.update((draft) => {
      draft.count++
      throw new Error('rollback')
    })).toThrow('rollback')
    expect(scenario.getState()).toEqual({ count: 0 })
    expect(() => scenario.update(async (draft) => {
      draft.count++
      await Promise.resolve()
      draft.count++
    })).toThrow('synchronous')
    await Promise.resolve()
    expect(scenario.getState()).toEqual({ count: 0 })
  })

  it('chooses cloned named or seeded variants without inherited property access', () => {
    const variants = { success: { status: 200 }, failure: { status: 500 } }
    const first = createScenario('seed', {})
    const second = createScenario('seed', {})
    expect(first.choose(variants)).toEqual(second.choose(variants))
    first.choose(variants, 'success').status = 201
    expect(variants.success.status).toBe(200)
    expect(() => first.choose(variants, 'toString')).toThrow('Unknown')
    expect(() => first.pick([])).toThrow('empty')
  })

  it('validates seeds, integer ranges and snapshots before state changes', () => {
    expect(() => createScenario(Number.NaN, {})).toThrow('seed')
    const scenario = createScenario(1, { value: 1 })
    expect(() => scenario.integer(2, 1)).toThrow('bounds')
    expect(() => scenario.integer(0, 1.5)).toThrow('bounds')
    expect(() => scenario.integer(0, 2 ** 32)).toThrow('bounds')
    expect(() => scenario.restore({ ...scenario.snapshot(), seed: 2, state: { value: 2 } })).toThrow('snapshot')
    expect(scenario.getState()).toEqual({ value: 1 })
    expect(createScenario('😀', {}).random()).not.toBe(createScenario('😁', {}).random())
  })
})

describe('named scenario catalogs', () => {
  it('selects and composes named states without mutating source scenarios', () => {
    const base = createScenario('base', { authenticated: true, latency: 0, code: 200 })
    const error = createScenario('error', { authenticated: false, latency: 0, code: 500 })
    const catalog = createScenarioCatalog({ base, error }, 'base')
    expect(catalog.names()).toEqual(['base', 'error'])
    expect(catalog.current().getState()).toEqual({ authenticated: true, latency: 0, code: 200 })
    catalog.compose('slow-error', 'error', 'base')
    expect(catalog.names()).toEqual(['base', 'error', 'slow-error'])
    expect(catalog.select('slow-error').getState()).toEqual({ authenticated: true, latency: 0, code: 200 })
    catalog.select('error').update((state) => {
      state.latency = 500
    })
    expect(error.getState()).toEqual({ authenticated: false, latency: 0, code: 500 })
    expect(catalog.current().getState()).toEqual({ authenticated: false, latency: 500, code: 500 })
  })

  it('forks and restores parallel session state independently', () => {
    const catalog = createScenarioCatalog({ happy: createScenario('checkout', { count: 0 }) })
    const fork = catalog.fork()
    catalog.current().update((state) => {
      state.count = 1
    })
    fork.current().update((state) => {
      state.count = 2
    })
    expect(catalog.current().getState()).toEqual({ count: 1 })
    expect(fork.current().getState()).toEqual({ count: 2 })
    const checkpoint = catalog.snapshot()
    catalog.current().update((state) => {
      state.count = 9
    })
    catalog.restore(checkpoint)
    expect(catalog.current().getState()).toEqual({ count: 1 })
    expect(() => catalog.select('missing')).toThrow('Unknown scenario')
    expect(() => catalog.restore({ ...checkpoint, active: 'missing' })).toThrow('Invalid scenario')
  })
})

describe('memory CRUD store', () => {
  it('supports CRUD, filtered lists, snapshot restore and baseline reset', () => {
    const initial = [{ id: 'a', name: 'Ada', tags: ['one'] }]
    const store = createMemoryStore(initial, 'id')
    initial[0]!.tags.push('external')
    const created = store.create({ id: 'b', name: 'Lin', tags: [] })
    created.tags.push('external')
    expect(store.get('b')?.tags).toEqual([])
    expect(store.update('b', { name: 'Grace' })?.name).toBe('Grace')
    expect(store.list(row => row.name === 'Grace')).toEqual([{ id: 'b', name: 'Grace', tags: [] }])
    const snapshot = store.snapshot()
    expect(store.delete('a')).toBe(true)
    expect(store.get('a')).toBeUndefined()
    expect(store.delete('a')).toBe(false)
    expect(store.update('missing', { name: 'none' })).toBeUndefined()
    store.restore(snapshot)
    snapshot[0]!.tags.push('external')
    expect(store.get('a')?.tags).toEqual(['one'])
    store.clear()
    expect(store.list()).toEqual([])
    store.reset()
    expect(store.list()).toEqual([{ id: 'a', name: 'Ada', tags: ['one'] }])
  })

  it('rejects duplicate IDs, ID changes and invalid restores atomically', () => {
    const store = createMemoryStore([{ id: 1, value: 'first' }], 'id')
    expect(() => store.create({ id: 1, value: 'duplicate' })).toThrow('Duplicate')
    expect(() => store.update(1, { id: 2 })).toThrow('change its ID')
    expect(() => store.restore([{ id: 2, value: 'next' }, { id: 2, value: 'bad' }])).toThrow('Duplicate')
    expect(store.list()).toEqual([{ id: 1, value: 'first' }])
    expect(() => createMemoryStore([{ id: Number.NaN }], 'id')).toThrow('finite')
  })
})
