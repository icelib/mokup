import type { DiagnosticsCollector, DiagnosticsSnapshot } from '@mokup/runtime/diagnostics'
import type { HttpEventMap, MockSession } from '@mokup/runtime/http'
import type { MockPluginHost, MockPluginResourceInfo } from '@mokup/runtime/plugin'
import { createDiagnosticsCollector } from '@mokup/runtime/diagnostics'

/** The host contract is intentionally structural so Devframe stays optional. */
export interface DevframeHost {
  send: (message: DevframeMessage) => void
  onCommand?: (listener: (command: DevframeCommand) => void) => (() => void)
}

export type DevframeCommand
  = | { type: 'snapshot' }
    | { type: 'scenario.select', name: string }
    | { type: 'scenario.reset' }
    | { type: 'diagnostics.clear' }

export interface DevframeHandlerSnapshot {
  method: string
  matcher: string
  once: boolean
  active: boolean
}

export interface DevframeSnapshot {
  version: 1
  diagnostics: DiagnosticsSnapshot
  handlers: DevframeHandlerSnapshot[]
  scenarios: {
    names: string[]
    active?: string
  }
  resources: MockPluginResourceInfo[]
}

export type DevframeMessage
  = | { type: 'mokup:snapshot', snapshot: DevframeSnapshot }
    | { type: 'mokup:event', event: keyof HttpEventMap }
    | { type: 'mokup:error', command: DevframeCommand['type'], message: string }

export interface DevframeBridgeOptions {
  /** Reuse an existing collector when the host already owns one. */
  diagnostics?: DiagnosticsCollector
  /** Optionally expose plugin extension metadata to the Devframe panel. */
  plugins?: Pick<MockPluginHost, 'listResources'>
}

export interface DevframeBridge {
  snapshot: () => DevframeSnapshot
  connect: (host: DevframeHost) => () => void
  command: (command: DevframeCommand) => DevframeSnapshot
  dispose: () => void
}

const eventTypes = [
  'request:start',
  'request:match',
  'request:unhandled',
  'request:end',
  'response:mocked',
  'response:bypass',
  'unhandledException',
  'protocol:start',
  'protocol:match',
  'protocol:unhandled',
  'protocol:end',
  'protocol:error',
  'protocol:message',
] as const satisfies readonly (keyof HttpEventMap)[]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Expose Mokup diagnostics and scenario controls to an optional Devframe host.
 *
 * The bridge only speaks a small structural message protocol. Devframe can
 * provide a host adapter over postMessage, WebSocket, or an embedded panel;
 * the Mokup runtime never imports or requires Devframe.
 */
export function createDevframeBridge(session: MockSession, options: DevframeBridgeOptions = {}): DevframeBridge {
  const diagnostics = options.diagnostics ?? createDiagnosticsCollector(session)
  const ownsDiagnostics = options.diagnostics === undefined
  const hosts = new Set<DevframeHost>()
  const commandUnsubscribers = new Map<DevframeHost, () => void>()
  let disposed = false

  const snapshot = (): DevframeSnapshot => {
    const scenario = session.scenario
    return {
      version: 1,
      diagnostics: diagnostics.snapshot(),
      handlers: session.listHandlers().map(handler => ({
        method: String(handler.method),
        matcher: typeof handler.matcher === 'string' ? handler.matcher : handler.matcher instanceof RegExp ? handler.matcher.toString() : '[predicate]',
        once: handler.once,
        active: true,
      })),
      scenarios: {
        names: scenario ? [...scenario.names()] : [],
        ...(scenario ? { active: scenario.active() } : {}),
      },
      resources: options.plugins ? [...options.plugins.listResources()] : [],
    }
  }

  const broadcast = (message: DevframeMessage) => {
    for (const host of hosts) {
      try {
        host.send(message)
      }
      catch {
        // A panel can disappear while a request is in flight. The runtime
        // remains healthy and the host may reconnect to receive a fresh snapshot.
      }
    }
  }

  const command = (value: DevframeCommand): DevframeSnapshot => {
    if (disposed) {
      throw new Error('Cannot command a disposed Devframe bridge.')
    }
    switch (value.type) {
      case 'snapshot':
        break
      case 'diagnostics.clear':
        diagnostics.clear()
        break
      case 'scenario.reset':
        session.resetScenario()
        break
      case 'scenario.select':
        session.selectScenario(value.name)
        break
    }
    const next = snapshot()
    broadcast({ type: 'mokup:snapshot', snapshot: next })
    return next
  }

  const removeEventListeners = eventTypes.map(type => session.events.on(type, () => {
    if (!disposed) {
      broadcast({ type: 'mokup:event', event: type })
    }
  }))

  return {
    snapshot,
    connect(host) {
      if (disposed) {
        throw new Error('Cannot connect a disposed Devframe bridge.')
      }
      hosts.add(host)
      host.send({ type: 'mokup:snapshot', snapshot: snapshot() })
      const unsubscribe = host.onCommand?.((value) => {
        try {
          command(value)
        }
        catch (error) {
          host.send({ type: 'mokup:error', command: value.type, message: errorMessage(error) })
        }
      })
      if (unsubscribe) {
        commandUnsubscribers.set(host, unsubscribe)
      }
      return () => {
        commandUnsubscribers.get(host)?.()
        commandUnsubscribers.delete(host)
        hosts.delete(host)
      }
    },
    command,
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      for (const unsubscribe of commandUnsubscribers.values()) {
        unsubscribe()
      }
      commandUnsubscribers.clear()
      hosts.clear()
      for (const unsubscribe of removeEventListeners) {
        unsubscribe()
      }
      if (ownsDiagnostics) {
        diagnostics.dispose()
      }
    },
  }
}
