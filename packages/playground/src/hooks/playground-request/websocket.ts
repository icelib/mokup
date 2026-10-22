import type { RequestDecision } from './history'

type RouteCounts = Record<string, number>
interface PlaygroundScenario {
  names: string[]
  active: string
}
interface PlaygroundHandlerCoverage {
  id: string
  method: string
  matcher: string
  once: boolean
  active: boolean
  matched: number
  mocked: number
}
interface PlaygroundDiagnosticsTotals {
  started: number
  completed: number
  mocked: number
  bypassed: number
  unhandled: number
  errors: number
}
interface PlaygroundWsDiagnostic {
  type: 'diagnostic'
  entry: {
    sequence: number
    timestamp: number
    type: string
    requestId: string
    method: string
    url: string
    protocol?: 'graphql' | 'sse' | 'websocket'
    connectionId?: string
    matcher?: string
    operation?: string
    handlerId?: string
    status?: number
    decisionChain?: RequestDecision[]
    error?: { name: string, message: string }
  }
  handlers: PlaygroundHandlerCoverage[]
  totals: PlaygroundDiagnosticsTotals
}
interface PlaygroundWsSnapshot {
  type: 'snapshot'
  total: number
  perRoute: RouteCounts
  scenario?: PlaygroundScenario
  diagnostics?: Omit<PlaygroundWsDiagnostic, 'type' | 'entry'> & { timeline: PlaygroundWsDiagnostic['entry'][] }
}
interface PlaygroundWsIncrement {
  type: 'increment'
  routeKey: string
  total: number
}
interface PlaygroundWsScenario {
  type: 'scenario'
  scenario: PlaygroundScenario
}
interface PlaygroundWsScenarioError {
  type: 'scenario:error'
  message: string
}

function isPlaygroundWsEnabled() {
  if (import.meta.env.DEV) {
    return true
  }
  const raw = import.meta.env.VITE_MOKUP_PLAYGROUND_WS
  if (!raw) {
    return false
  }
  const normalized = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }
  return false
}

function resolvePlaygroundWsUrl(basePath: string) {
  if (!isPlaygroundWsEnabled()) {
    return ''
  }
  const trimmed = basePath.trim()
  if (!trimmed) {
    return ''
  }
  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const path = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
  const url = new URL(`${path}/ws`, window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function parseWsMessage(data: string) {
  try {
    const parsed = JSON.parse(data) as PlaygroundWsSnapshot | PlaygroundWsIncrement | PlaygroundWsDiagnostic | PlaygroundWsScenario | PlaygroundWsScenarioError
    if (parsed.type === 'snapshot' && parsed.perRoute) {
      return parsed
    }
    if (parsed.type === 'increment' && typeof parsed.routeKey === 'string') {
      return parsed
    }
    if (parsed.type === 'diagnostic' && parsed.entry && typeof parsed.entry.requestId === 'string') {
      return parsed
    }
    if (parsed.type === 'scenario' && parsed.scenario && Array.isArray(parsed.scenario.names) && typeof parsed.scenario.active === 'string') {
      return parsed
    }
    if (parsed.type === 'scenario:error' && typeof parsed.message === 'string') {
      return parsed
    }
  }
  catch {
    return null
  }
  return null
}

export type { PlaygroundDiagnosticsTotals, PlaygroundHandlerCoverage, PlaygroundScenario, PlaygroundWsDiagnostic, PlaygroundWsIncrement, PlaygroundWsScenario, PlaygroundWsScenarioError, PlaygroundWsSnapshot, RouteCounts }
export { parseWsMessage, resolvePlaygroundWsUrl }
