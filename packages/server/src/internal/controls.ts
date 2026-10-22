import type { createRuntime } from '@mokup/runtime'
import type { RuntimeControls } from '../types'

export function withRuntimeControls<T extends object>(adapter: T, runtime: ReturnType<typeof createRuntime>): T & RuntimeControls {
  const controlled = Object.assign(adapter, {
    signal: runtime.signal,
    ready: runtime.ready,
    use: runtime.use,
    resetHandlers: runtime.resetHandlers,
    restoreHandlers: runtime.restoreHandlers,
    listHandlers: runtime.listHandlers,
    setOnUnhandled: runtime.setOnUnhandled,
    selectScenario: runtime.selectScenario,
    resetScenario: runtime.resetScenario,
    events: runtime.events,
    close: runtime.close,
  })
  Object.defineProperty(controlled, 'scenario', {
    configurable: true,
    enumerable: true,
    get: () => runtime.scenario,
  })
  return controlled as T & RuntimeControls
}
