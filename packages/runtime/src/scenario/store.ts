export type StoreId = string | number

export interface MemoryStore<T> {
  list: (predicate?: (record: T) => boolean) => T[]
  get: (id: StoreId) => T | undefined
  create: (record: T) => T
  update: (id: StoreId, changes: Partial<T>) => T | undefined
  delete: (id: StoreId) => boolean
  clear: () => void
  reset: () => void
  snapshot: () => T[]
  restore: (records: readonly T[]) => void
}

/** Clone-isolated CRUD fixtures; updates preserve IDs and insertion order. */
export function createMemoryStore<T extends object>(initialRecords: readonly T[], idKey: keyof T): MemoryStore<T> {
  const getId = (record: T): StoreId => {
    const id = record[idKey]
    if (typeof id !== 'string' && (typeof id !== 'number' || !Number.isFinite(id))) {
      throw new TypeError(`Record ${String(idKey)} must be a string or finite number.`)
    }
    return id
  }
  const build = (records: readonly T[]) => {
    const next = new Map<StoreId, T>()
    for (const record of records) {
      const copy = structuredClone(record)
      const id = getId(copy)
      if (next.has(id)) {
        throw new Error(`Duplicate record ID: ${id}`)
      }
      next.set(id, copy)
    }
    return next
  }
  const baseline = structuredClone(initialRecords)
  let records = build(baseline)
  const snapshot = () => structuredClone([...records.values()])
  return {
    list: predicate => predicate ? snapshot().filter(predicate) : snapshot(),
    get: id => structuredClone(records.get(id)),
    create: (record) => {
      const copy = structuredClone(record)
      const id = getId(copy)
      if (records.has(id)) {
        throw new Error(`Duplicate record ID: ${id}`)
      }
      records.set(id, copy)
      return structuredClone(copy)
    },
    update: (id, changes) => {
      const current = records.get(id)
      if (!current) {
        return undefined
      }
      const next = { ...current, ...structuredClone(changes) }
      if (getId(next) !== id) {
        throw new Error('A record update cannot change its ID.')
      }
      records.set(id, next)
      return structuredClone(next)
    },
    delete: id => records.delete(id),
    clear: () => { records.clear() },
    reset: () => { records = build(baseline) },
    snapshot,
    restore: (next) => { records = build(next) },
  }
}
