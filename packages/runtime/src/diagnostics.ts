import type { HttpEventMap, HttpEvents, HttpHandler, HttpMatchDecision, MockProtocol, MockSession } from './http/types'

export interface DiagnosticsEntry {
  sequence: number
  timestamp: number
  type: keyof HttpEventMap
  requestId: string
  method: string
  url: string
  protocol?: MockProtocol
  connectionId?: string
  matcher?: string
  operation?: string
  reason?: string
  handlerId?: string
  status?: number
  decisionChain?: HttpMatchDecision[]
  error?: { name: string, message: string }
}

export interface HandlerCoverage {
  id: string
  method: string
  matcher: string
  once: boolean
  active: boolean
  matched: number
  mocked: number
}

export interface DiagnosticsSnapshot {
  version: 1
  /** Oldest entries are evicted when the configured bound is reached. */
  timeline: DiagnosticsEntry[]
  handlers: HandlerCoverage[]
  totals: {
    started: number
    completed: number
    mocked: number
    bypassed: number
    unhandled: number
    errors: number
  }
}

export interface DiagnosticsOptions {
  maxEntries?: number
  now?: () => number
}

export interface DiagnosticsCollector {
  snapshot: () => DiagnosticsSnapshot
  serialize: () => string
  clear: () => void
  /** Detach only this collector's subscriptions; preserve the final snapshot. */
  dispose: () => void
}

function describeMatcher(handler: HttpHandler) {
  if (typeof handler.matcher === 'string') {
    return handler.matcher
  }
  return handler.matcher instanceof RegExp ? handler.matcher.toString() : '[predicate]'
}

/** Collect actual session event metadata without reading request or response bodies. */
export function createDiagnosticsCollector(
  source: { events: HttpEvents, listHandlers?: MockSession['listHandlers'] },
  options: DiagnosticsOptions = {},
): DiagnosticsCollector {
  const maxEntries = options.maxEntries ?? 1000
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError('Diagnostics maxEntries must be a positive safe integer.')
  }
  const now = options.now ?? Date.now
  const timeline: DiagnosticsEntry[] = []
  const ids = new WeakMap<HttpHandler, string>()
  const coverage = new Map<string, HandlerCoverage>()
  const totals = { started: 0, completed: 0, mocked: 0, bypassed: 0, unhandled: 0, errors: 0 }
  let nextId = 0
  let sequence = 0
  let disposed = false

  const ensureHandler = (handler: HttpHandler) => {
    let id = ids.get(handler)
    if (!id) {
      id = `handler-${++nextId}`
      ids.set(handler, id)
    }
    let entry = coverage.get(id)
    if (!entry) {
      entry = { id, method: String(handler.method), matcher: describeMatcher(handler), once: handler.once, active: true, matched: 0, mocked: 0 }
      coverage.set(id, entry)
    }
    return entry
  }
  const syncHandlers = () => {
    if (!source.listHandlers) {
      return
    }
    for (const entry of coverage.values()) {
      entry.active = false
    }
    for (const handler of source.listHandlers()) {
      ensureHandler(handler).active = true
    }
  }
  syncHandlers()

  const record = <T extends keyof HttpEventMap>(type: T, event: HttpEventMap[T]) => {
    const entry: DiagnosticsEntry = {
      sequence: ++sequence,
      timestamp: now(),
      type,
      requestId: event.requestId,
      method: event.method,
      url: event.url,
    }
    if ('handler' in event) {
      const handler = ensureHandler(event.handler)
      entry.handlerId = handler.id
      if (type === 'request:match') {
        handler.matched++
      }
      if (type === 'response:mocked') {
        handler.mocked++
      }
    }
    if ('protocol' in event) {
      entry.protocol = event.protocol
      if (event.connectionId) {
        entry.connectionId = event.connectionId
      }
      if (event.operation) {
        entry.operation = event.operation
      }
      if (event.matcher) {
        entry.matcher = event.matcher
      }
    }
    if ('status' in event) {
      entry.status = event.status
    }
    if ('reason' in event) {
      entry.reason = event.reason
    }
    if ('decisionChain' in event) {
      entry.decisionChain = event.decisionChain.map(decision => ({ ...decision }))
    }
    if ('error' in event) {
      const error = event.error
      entry.error = error instanceof Error ? { name: error.name, message: error.message } : { name: 'Error', message: String(error) }
    }
    switch (type) {
      case 'request:start':
        totals.started++
        break
      case 'request:end':
        totals.completed++
        break
      case 'response:mocked':
        totals.mocked++
        break
      case 'response:bypass':
        totals.bypassed++
        break
      case 'request:unhandled':
        totals.unhandled++
        break
      case 'unhandledException':
        totals.errors++
        break
    }
    timeline.push(entry)
    if (timeline.length > maxEntries) {
      timeline.splice(0, timeline.length - maxEntries)
    }
  }
  const types = [
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
  ] as const
  const unsubscribe = types.map(type => source.events.on(type, event => record(type, event)))
  const snapshot = (): DiagnosticsSnapshot => {
    if (!disposed) {
      syncHandlers()
    }
    return {
      version: 1,
      timeline: timeline.map(entry => ({
        ...entry,
        ...(entry.error ? { error: { ...entry.error } } : {}),
        ...(entry.decisionChain ? { decisionChain: entry.decisionChain.map(decision => ({ ...decision })) } : {}),
      })),
      handlers: [...coverage.values()].map(entry => ({ ...entry })),
      totals: { ...totals },
    }
  }
  return {
    snapshot,
    serialize: () => JSON.stringify(snapshot()),
    clear() {
      timeline.length = 0
      coverage.clear()
      sequence = 0
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
        totals[key] = 0
      }
      syncHandlers()
    },
    dispose() {
      if (disposed) {
        return
      }
      syncHandlers()
      disposed = true
      for (const remove of unsubscribe) {
        remove()
      }
    },
  }
}
