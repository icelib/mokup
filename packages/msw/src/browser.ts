import type { SetupWorker as MokupSetupWorker, ServiceWorkerOptions } from 'mokup/browser'
import type { LifeCycleEventEmitter } from './compat-types'
import type { CompatibleHandler } from './handlers'
import type { CompatibilityOptions } from './options'
import { setupWorker as setupMokupWorker } from 'mokup/browser'
import { createHandlerAdapter } from './handlers'
import { createLifecycleEmitter } from './lifecycle'
import { normalizeOptions } from './options'

export type SetupWorker = Omit<MokupSetupWorker, 'events' | 'start' | 'use' | 'resetHandlers'> & {
  events: LifeCycleEventEmitter
  start: (options?: WorkerCompatibilityOptions) => Promise<void>
  use: (...handlers: CompatibleHandler[]) => void
  resetHandlers: (...handlers: CompatibleHandler[]) => void
}

export interface WorkerCompatibilityOptions extends CompatibilityOptions {
  mode?: 'serviceWorker' | 'interceptor'
  serviceWorker?: ServiceWorkerOptions
}

/** Browser interception uses Mokup's own worker protocol and script. */
export function setupWorker(...handlers: CompatibleHandler[]): SetupWorker {
  const adapt = createHandlerAdapter()
  const worker = setupMokupWorker(...handlers.map(adapt))
  const events = createLifecycleEmitter(worker.events)
  return {
    ...worker,
    events,
    get readyState() { return worker.readyState },
    get mode() { return worker.mode },
    async start(options = {}) {
      const { mode, serviceWorker, ...policy } = options
      await worker.start({
        ...normalizeOptions(policy),
        ...(mode === undefined ? {} : { mode }),
        ...(serviceWorker === undefined ? {} : { serviceWorker }),
      })
    },
    use: (...next) => {
      worker.use(...next.map(adapt))
    },
    resetHandlers: (...next) => {
      worker.resetHandlers(...next.map(adapt))
    },
  }
}

export type { CompatibilityOptions } from './options'
