import type { HttpEventMap, HttpEvents } from './types'

export function createHttpEvents() {
  type Listener = (event: never) => void
  const listeners = new Map<keyof HttpEventMap, Set<Listener>>()
  const off: HttpEvents['off'] = (type, listener) => {
    listeners.get(type)?.delete(listener as Listener)
  }
  function emit<T extends keyof HttpEventMap>(type: T, event: HttpEventMap[T]) {
    for (const listener of [...listeners.get(type) ?? []]) {
      listener(Object.freeze(event) as never)
    }
  }
  const events: HttpEvents = {
    on(type, listener) {
      let group = listeners.get(type)
      if (!group) {
        group = new Set()
        listeners.set(type, group)
      }
      group.add(listener as Listener)
      return () => off(type, listener)
    },
    off,
    removeListener: off,
    removeAllListeners(type) {
      if (type) {
        listeners.delete(type)
      }
      else {
        listeners.clear()
      }
    },
    emit,
  }
  return { events, emit }
}
