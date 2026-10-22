import type { WebSocketServerLike } from '@hono/node-server'
import type { DiagnosticsSnapshot } from '@mokup/runtime/diagnostics'
import type { MockSession } from '@mokup/runtime/http'
import type { resolvePlaygroundOptions } from '../dev/playground'
import type { MiddlewareHandler, ResolvedRoute } from '../dev/types'
import { createDiagnosticsCollector } from '@mokup/runtime/diagnostics'

type RouteCounts = Record<string, number>
interface PlaygroundWsSnapshot {
  type: 'snapshot'
  total: number
  perRoute: RouteCounts
  scenario?: PlaygroundWsScenario
  diagnostics?: Pick<DiagnosticsSnapshot, 'timeline' | 'handlers' | 'totals'>
}
interface PlaygroundWsIncrement {
  type: 'increment'
  routeKey: string
  total: number
}
interface PlaygroundWsDiagnostic {
  type: 'diagnostic'
  entry: DiagnosticsSnapshot['timeline'][number]
  handlers: DiagnosticsSnapshot['handlers']
  totals: DiagnosticsSnapshot['totals']
}
interface PlaygroundWsScenario {
  names: string[]
  active: string
}
interface PlaygroundWsScenarioFrame {
  type: 'scenario'
  scenario: PlaygroundWsScenario
}
interface PlaygroundWsScenarioError {
  type: 'scenario:error'
  message: string
}
type PlaygroundWsHandler = MiddlewareHandler<any, string, { outputFormat: 'ws' }>
interface PlaygroundWebSocketOptions {
  server: WebSocketServerLike
}

function createPlaygroundWs(playground: ReturnType<typeof resolvePlaygroundOptions>) {
  const routeCounts: RouteCounts = {}
  const wsClients = new Set<{ send: (data: string) => void }>()
  let totalCount = 0
  let wsHandler: PlaygroundWsHandler | undefined
  let websocket: PlaygroundWebSocketOptions | undefined
  let setup: Promise<void> | undefined
  let disposal: Promise<void> | undefined
  let closeServer: (() => Promise<void>) | undefined
  let disposed = false
  let diagnostics: ReturnType<typeof createDiagnosticsCollector> | undefined
  let attachedSession: MockSession | undefined
  let removeDiagnostics: Array<() => void> = []
  let lastFlushedMockSequence = 0

  function getRouteKey(route: ResolvedRoute) {
    return `${route.method} ${route.template}`
  }

  function buildSnapshot(): PlaygroundWsSnapshot {
    const snapshot: PlaygroundWsSnapshot = {
      type: 'snapshot',
      total: totalCount,
      perRoute: { ...routeCounts },
    }
    if (attachedSession?.scenario) {
      snapshot.scenario = {
        names: [...attachedSession.scenario.names()],
        active: attachedSession.scenario.active(),
      }
    }
    const current = diagnostics?.snapshot()
    if (current) {
      snapshot.diagnostics = {
        timeline: current.timeline,
        handlers: current.handlers,
        totals: current.totals,
      }
    }
    return snapshot
  }

  function scenarioSnapshot(): PlaygroundWsScenario | undefined {
    if (!attachedSession?.scenario) {
      return undefined
    }
    return {
      names: [...attachedSession.scenario.names()],
      active: attachedSession.scenario.active(),
    }
  }

  function broadcast(payload: PlaygroundWsSnapshot | PlaygroundWsIncrement | PlaygroundWsDiagnostic | PlaygroundWsScenarioFrame) {
    if (wsClients.size === 0) {
      return
    }
    const message = JSON.stringify(payload)
    for (const client of wsClients) {
      try {
        client.send(message)
      }
      catch {
        wsClients.delete(client)
      }
    }
  }

  function registerWsClient(client: { send: (data: string) => void }) {
    if (disposed) {
      return
    }
    wsClients.add(client)
    try {
      client.send(JSON.stringify(buildSnapshot()))
    }
    catch {
      wsClients.delete(client)
    }
  }

  function handleRouteResponse(route: ResolvedRoute) {
    if (disposed) {
      return
    }
    const routeKey = getRouteKey(route)
    routeCounts[routeKey] = (routeCounts[routeKey] ?? 0) + 1
    totalCount += 1
    const total = totalCount
    // The route callback is scheduled by the Hono adapter before the shared
    // session emits its terminal events. Flush after the current microtask so
    // the diagnostic snapshot includes `response:mocked`, then publish the
    // counter frame that clients use as the request completion marker.
    setTimeout(() => {
      if (disposed) {
        return
      }
      const current = diagnostics?.snapshot()
      if (current) {
        const terminals = current.timeline.filter(entry => entry.type === 'response:mocked' && entry.sequence > lastFlushedMockSequence)
        for (const entry of terminals) {
          broadcast({ type: 'diagnostic', entry, handlers: current.handlers, totals: current.totals })
          lastFlushedMockSequence = Math.max(lastFlushedMockSequence, entry.sequence)
        }
      }
      broadcast({ type: 'increment', routeKey, total })
    })
  }

  function handleClientMessage(data: unknown, client: { send: (data: string) => void }) {
    if (!attachedSession || typeof data !== 'string') {
      return
    }
    let message: unknown
    try {
      message = JSON.parse(data)
    }
    catch {
      return
    }
    if (!message || typeof message !== 'object' || Array.isArray(message) || (message as { type?: unknown }).type !== 'scenario') {
      return
    }
    const input = message as { action?: unknown, name?: unknown }
    try {
      if (input.action === 'reset') {
        attachedSession.resetScenario()
      }
      else if (input.action === 'select' && typeof input.name === 'string') {
        attachedSession.selectScenario(input.name)
      }
      else {
        throw new TypeError('Scenario control requires select with a name or reset.')
      }
      const scenario = scenarioSnapshot()
      if (scenario) {
        broadcast({ type: 'scenario', scenario })
      }
    }
    catch (error) {
      try {
        client.send(JSON.stringify({ type: 'scenario:error', message: error instanceof Error ? error.message : String(error) } satisfies PlaygroundWsScenarioError))
      }
      catch {
        wsClients.delete(client)
      }
    }
  }

  function attachSession(nextSession: MockSession) {
    // Keep the session reference for snapshots and explicit Playground controls.
    // The diagnostics collector is recreated when the route session is replaced.
    attachedSession = nextSession
    for (const remove of removeDiagnostics) {
      remove()
    }
    diagnostics?.dispose()
    diagnostics = createDiagnosticsCollector(nextSession)
    const types = ['request:start', 'request:match', 'request:unhandled', 'request:end', 'response:mocked', 'response:bypass', 'unhandledException'] as const
    removeDiagnostics = types.map(type => nextSession.events.on(type, () => {
      try {
        const snapshot = diagnostics?.snapshot()
        const entry = snapshot?.timeline.at(-1)
        if (!snapshot || !entry) {
          return
        }
        broadcast({ type: 'diagnostic', entry, handlers: snapshot.handlers, totals: snapshot.totals })
      }
      catch {
        // Observability must never change request execution or teardown behavior.
      }
    }))
  }

  async function preparePlaygroundWebSocket() {
    if (!playground.enabled) {
      return
    }
    try {
      const [{ upgradeWebSocket }, { WebSocketServer }] = await Promise.all([
        import('@hono/node-server'),
        import('ws'),
      ])
      wsHandler = upgradeWebSocket(() => ({
        onOpen: (_event, ws) => {
          registerWsClient(ws)
        },
        onClose: (_event, ws) => {
          wsClients.delete(ws)
        },
        onMessage: (event, ws) => {
          handleClientMessage(event.data, ws)
        },
      }))
      const server = new WebSocketServer({ noServer: true })
      let closed = false
      server.once('close', () => {
        closed = true
      })
      closeServer = () => closed
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            for (const client of server.clients) {
              client.terminate()
            }
            server.close(error => error ? reject(error) : resolve())
          })
      websocket = { server: server as unknown as WebSocketServerLike }
    }
    catch {
      // ignore websocket setup failures
    }
  }

  return {
    handleRouteResponse,
    attachSession,
    setupPlaygroundWebSocket() {
      if (disposed) {
        return Promise.reject(new Error('Cannot start a disposed Playground WebSocket server.'))
      }
      setup ??= preparePlaygroundWebSocket()
      return setup
    },
    dispose() {
      if (!disposal) {
        disposed = true
        disposal = Promise.resolve().then(async () => {
          await setup
          for (const remove of removeDiagnostics) {
            remove()
          }
          removeDiagnostics = []
          diagnostics?.dispose()
          diagnostics = undefined
          attachedSession = undefined
          wsClients.clear()
          await closeServer?.()
        })
      }
      return disposal
    },
    getWsHandler: () => wsHandler,
    getWebSocketOptions: () => websocket,
  }
}

export { createPlaygroundWs }
