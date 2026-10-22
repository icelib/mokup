import type { Scenario, ScenarioSnapshot } from './scenario'
import { createScenario } from './scenario'

export interface ScenarioCatalogSnapshot<T> {
  version: 1
  active: string
  scenarios: Record<string, ScenarioSnapshot<T>>
}

export interface ScenarioCatalog<T extends object> {
  /** Stable names in insertion order. */
  names: () => readonly string[]
  active: () => string
  current: () => Scenario<T>
  select: (name: string) => Scenario<T>
  /** Merge object states in order; later scenarios override earlier keys. */
  compose: (name: string, ...layers: string[]) => Scenario<T>
  snapshot: () => ScenarioCatalogSnapshot<T>
  restore: (snapshot: ScenarioCatalogSnapshot<T>) => void
  reset: () => void
  /** Clone every scenario and its active selection for an isolated test or session. */
  fork: () => ScenarioCatalog<T>
}

function cloneScenario<T>(source: Scenario<T>): Scenario<T> {
  const snapshot = source.snapshot()
  const clone = createScenario(snapshot.seed, snapshot.state)
  clone.restore(snapshot)
  return clone
}

/**
 * Build a named set of isolated scenarios.
 *
 * Each supplied scenario is cloned on entry, so the catalog never mutates a
 * caller-owned instance. `compose` creates another independent scenario whose
 * state is the shallow object merge of the selected layers.
 */
export function createScenarioCatalog<T extends object>(
  definitions: Readonly<Record<string, Scenario<T>>>,
  active?: string,
): ScenarioCatalog<T> {
  const scenarios = new Map<string, Scenario<T>>()
  for (const [name, scenario] of Object.entries(definitions)) {
    if (!name.trim()) {
      throw new TypeError('Scenario names must be nonempty.')
    }
    if (scenarios.has(name)) {
      throw new TypeError(`Duplicate scenario name: ${name}`)
    }
    scenarios.set(name, cloneScenario(scenario))
  }
  if (!scenarios.size) {
    throw new RangeError('A scenario catalog requires at least one scenario.')
  }
  let selected = active ?? scenarios.keys().next().value as string
  if (!scenarios.has(selected)) {
    throw new RangeError(`Unknown scenario: ${selected}`)
  }

  const names = () => Object.freeze([...scenarios.keys()])
  const select = (name: string) => {
    const scenario = scenarios.get(name)
    if (!scenario) {
      throw new RangeError(`Unknown scenario: ${name}`)
    }
    selected = name
    return scenario
  }
  const current = () => scenarios.get(selected)!
  const snapshot = (): ScenarioCatalogSnapshot<T> => ({
    version: 1,
    active: selected,
    scenarios: Object.fromEntries([...scenarios.entries()].map(([name, scenario]) => [name, scenario.snapshot()])),
  })
  const restore = (input: ScenarioCatalogSnapshot<T>) => {
    if (input.version !== 1 || typeof input.active !== 'string' || !scenarios.has(input.active)) {
      throw new TypeError('Invalid scenario catalog snapshot.')
    }
    for (const [name, scenario] of scenarios) {
      const saved = input.scenarios[name]
      if (!saved) {
        throw new TypeError(`Scenario catalog snapshot is missing ${name}.`)
      }
      scenario.restore(saved)
    }
    selected = input.active
  }
  const reset = () => {
    for (const scenario of scenarios.values()) {
      scenario.reset()
    }
    selected = active ?? scenarios.keys().next().value as string
  }
  return {
    names,
    active: () => selected,
    current,
    select,
    compose(name, ...layers) {
      if (!name.trim()) {
        throw new TypeError('Scenario names must be nonempty.')
      }
      if (scenarios.has(name)) {
        throw new TypeError(`Scenario name already exists: ${name}`)
      }
      const selectedLayers = layers.length ? layers : [selected]
      const states = selectedLayers.map((layer) => {
        const scenario = scenarios.get(layer)
        if (!scenario) {
          throw new RangeError(`Unknown scenario: ${layer}`)
        }
        return scenario.getState()
      })
      const seed = selectedLayers.map(layer => String(scenarios.get(layer)!.snapshot().seed)).join('|')
      const merged = Object.assign({}, ...states) as T
      const composed = createScenario(seed, merged)
      scenarios.set(name, composed)
      return composed
    },
    snapshot,
    restore,
    reset,
    fork() {
      const saved = snapshot()
      const cloned = createScenarioCatalog(
        Object.fromEntries(Object.entries(saved.scenarios).map(([name, item]) => [name, createScenario(item.seed, item.state)])),
        saved.active,
      )
      cloned.restore(saved)
      return cloned
    },
  }
}
