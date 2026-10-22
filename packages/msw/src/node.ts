import type { SetupServer as MokupSetupServer } from 'mokup/node'
import type { LifeCycleEventEmitter } from './compat-types'
import type { CompatibleHandler } from './handlers'
import type { CompatibilityOptions } from './options'
import { setupServer as setupMokupServer } from 'mokup/node'
import { createHandlerAdapter } from './handlers'
import { createLifecycleEmitter } from './lifecycle'
import { normalizeOptions } from './options'

export type SetupServer = Omit<MokupSetupServer, 'events' | 'listen' | 'use' | 'resetHandlers'> & {
  events: LifeCycleEventEmitter
  listen: (options?: CompatibilityOptions) => void
  use: (...handlers: CompatibleHandler[]) => void
  resetHandlers: (...handlers: CompatibleHandler[]) => void
}

/** Use MSW-style HTTP imports with Mokup's Node transport and lifecycle. */
export function setupServer(...handlers: CompatibleHandler[]): SetupServer {
  const adapt = createHandlerAdapter()
  const server = setupMokupServer(...handlers.map(adapt))
  const events = createLifecycleEmitter(server.events)
  return {
    ...server,
    events,
    get readyState() { return server.readyState },
    listen: options => server.listen(normalizeOptions(options)),
    use: (...next) => {
      server.use(...next.map(adapt))
    },
    resetHandlers: (...next) => {
      server.resetHandlers(...next.map(adapt))
    },
  }
}

export type { CompatibilityOptions } from './options'
