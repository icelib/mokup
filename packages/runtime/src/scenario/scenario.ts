export interface ScenarioSnapshot<T> {
  version: 1
  seed: string | number
  randomState: number
  state: T
}

export interface Scenario<T> {
  random: () => number
  integer: (min: number, max: number) => number
  pick: <V>(values: readonly V[]) => V
  choose: <V>(variants: Readonly<Record<string, V>>, name?: string) => V
  getState: () => T
  setState: (state: T) => void
  update: (mutate: (draft: T) => void) => T
  reset: () => void
  snapshot: () => ScenarioSnapshot<T>
  restore: (snapshot: ScenarioSnapshot<T>) => void
}

function hashSeed(seed: string | number) {
  if (typeof seed !== 'string' && (typeof seed !== 'number' || !Number.isFinite(seed))) {
    throw new TypeError('Scenario seed must be a string or a finite number.')
  }
  let hash = 2166136261
  const value = `${typeof seed}:${seed}`
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  }
  return hash >>> 0
}

/** Create an isolated, reproducible scenario. State must support structuredClone. */
export function createScenario<T>(seed: string | number, initialState: T): Scenario<T> {
  const initialRandomState = hashSeed(seed)
  const initial = structuredClone(initialState)
  let state = structuredClone(initial)
  let randomState = initialRandomState

  const random = () => {
    randomState = (randomState + 0x6D2B79F5) >>> 0
    let value = randomState
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  const integer = (min: number, max: number) => {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max || max - min >= 4294967296) {
      throw new RangeError('Scenario integer bounds must be safe integers spanning at most 2^32 values.')
    }
    return min + Math.floor(random() * (max - min + 1))
  }
  const pick = <V>(values: readonly V[]): V => {
    if (!values.length) {
      throw new RangeError('Cannot choose from an empty set of variants.')
    }
    return structuredClone(values[integer(0, values.length - 1)]!)
  }
  return {
    random,
    integer,
    pick,
    choose: <V>(variants: Readonly<Record<string, V>>, name?: string): V => {
      if (name !== undefined) {
        if (!Object.hasOwn(variants, name)) {
          throw new RangeError(`Unknown scenario variant: ${name}`)
        }
        return structuredClone(variants[name]!)
      }
      return pick(Object.values(variants))
    },
    getState: () => structuredClone(state),
    setState: (next) => { state = structuredClone(next) },
    update: (mutate) => {
      const draft = structuredClone(state)
      const result: unknown = mutate(draft)
      if (result && typeof result === 'object' && 'then' in result) {
        // A detached async draft must never publish partial state.
        void Promise.resolve(result).catch(() => {})
        throw new TypeError('Scenario updates must be synchronous.')
      }
      state = structuredClone(draft)
      return structuredClone(state)
    },
    reset: () => {
      state = structuredClone(initial)
      randomState = initialRandomState
    },
    snapshot: () => ({ version: 1, seed, randomState, state: structuredClone(state) }),
    restore: (snapshot) => {
      if (snapshot.version !== 1 || snapshot.seed !== seed
        || !Number.isInteger(snapshot.randomState) || snapshot.randomState < 0 || snapshot.randomState > 0xFFFFFFFF) {
        throw new TypeError('Invalid scenario snapshot or mismatched seed.')
      }
      const next = structuredClone(snapshot.state)
      state = next
      randomState = snapshot.randomState
    },
  }
}
