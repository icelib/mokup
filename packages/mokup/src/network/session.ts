import type { HttpHandler, HttpScenario, MockSession, UnhandledRequestPolicy } from '@mokup/runtime/http'
import { createMockSession } from '@mokup/runtime/http'

export interface NetworkOptions {
  /** Unmatched requests pass through by default. Use error in isolated tests. */
  onUnhandled?: UnhandledRequestPolicy
}

/** Options shared by the persistent session and its transport attachments. */
export interface NetworkSessionOptions extends NetworkOptions {
  /** Clone this catalog into each started session and expose scenario controls. */
  scenario?: HttpScenario
}

export interface NetworkController {
  readonly events: MockSession['events']
  readonly readyState: 'started' | 'stopped'
  use: MockSession['use']
  resetHandlers: MockSession['resetHandlers']
  restoreHandlers: MockSession['restoreHandlers']
  listHandlers: MockSession['listHandlers']
  /** Select a named scenario for the active session and all future sessions. */
  selectScenario: MockSession['selectScenario']
  /** Reset the selected scenario in the active session and its persistent definitions. */
  resetScenario: MockSession['resetScenario']
}

/** Separate persistent definitions from the resources owned by each start. */
export function createNetworkSession(
  handlers: HttpHandler[],
  scope: () => MockSession | undefined = () => undefined,
  options: NetworkSessionOptions = {},
) {
  const definitions = createMockSession({
    handlers,
    ...(options.onUnhandled === undefined ? {} : { onUnhandled: options.onUnhandled }),
    ...(options.scenario ? { scenario: options.scenario } : {}),
  })
  const boundaries = new Set<MockSession>()
  let active: MockSession | undefined
  let detach: (() => Promise<void>) | undefined
  let closing: Promise<void> | undefined

  const current = () => scope() ?? active ?? definitions
  const modify = (operation: (session: MockSession) => void) => {
    const scoped = scope()
    if (scoped) {
      operation(scoped)
      return
    }
    operation(definitions)
    if (active) {
      operation(active)
    }
  }

  const controller: NetworkController = {
    events: definitions.events,
    get readyState() { return active ? 'started' : 'stopped' },
    use: (...next) => modify(session => session.use(...next)),
    resetHandlers: (...next) => modify(session => session.resetHandlers(...next)),
    restoreHandlers: () => modify(session => session.restoreHandlers()),
    listHandlers: () => current().listHandlers(),
    selectScenario: name => modify(session => session.selectScenario(name)),
    resetScenario: () => {
      const scoped = scope()
      if (scoped) {
        scoped.resetScenario()
        return
      }
      definitions.resetScenario()
      if (active) {
        active.resetScenario()
        const selected = definitions.scenario?.active()
        if (selected) {
          active.selectScenario(selected)
        }
      }
    },
  }

  function start(attach: (session: () => MockSession) => () => Promise<void>, options: NetworkOptions = {}) {
    if (active) {
      return
    }
    if (options.onUnhandled !== undefined) {
      definitions.setOnUnhandled(options.onUnhandled)
    }
    const next = definitions.fork()
    active = next
    try {
      detach = attach(current)
    }
    catch (error) {
      active = undefined
      void next.dispose()
      throw error
    }
  }

  function stop(): Promise<void> {
    if (!active) {
      return closing ?? Promise.resolve()
    }
    const previous = active
    active = undefined
    const detached = detach?.()
    detach = undefined
    const owned = [...boundaries]
    boundaries.clear()
    // Dispose first: a resolver waiting indefinitely must not block teardown.
    const disposal = [previous, ...owned].map(session => session.dispose())
    closing = Promise.allSettled([...disposal, detached]).then((results) => {
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
      if (errors.length) {
        throw new AggregateError(errors, 'Mock network session shutdown failed.')
      }
    })
    return closing
  }

  function fork() {
    const session = current().fork()
    boundaries.add(session)
    return {
      session,
      async dispose() {
        boundaries.delete(session)
        await session.dispose()
      },
    }
  }

  return { controller, current, start, stop, fork }
}
