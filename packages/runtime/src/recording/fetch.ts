import type { RecordedFixture, RecordingOptions } from './types'
import { withAbort } from '../http/resources'
import { bodyLimits, readBody } from './body'
import { fixtureFromBodies, validateResponse, validateTiming } from './fixture'
import { normalizeRedaction } from './redact'

export interface RecordingFetchOptions extends Omit<RecordingOptions, 'startedAt' | 'durationMs'> {
  /** Retained fixtures plus reserved captures. Full recorders skip capture, never forwarding. Default 100. */
  maxEntries?: number
  /** Maximum concurrent captures, including requests awaiting upstream response headers. Default 8. */
  maxInFlight?: number
}

export interface RecordingFetchIssue {
  requestId: number
  code: 'capacity' | 'capture-failed'
  stage: 'capacity' | 'request' | 'forward' | 'response' | 'redaction'
}

export interface RecordingFetch {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  /** Copies of complete redacted fixtures, in request invocation order. */
  fixtures: () => RecordedFixture[]
  /** Bounded, value-free diagnostics; raw upstream errors and request data are never retained here. */
  errors: () => RecordingFetchIssue[]
  /** Await captures currently registered. Does not wait for later fetch calls. */
  flush: () => Promise<void>
  /** Drop retained data and cancel owned captures, without aborting forwarded requests. */
  clear: () => void
}

class CaptureFailure extends Error {
  constructor(readonly stage: RecordingFetchIssue['stage']) {
    super('Recording capture failed.')
  }
}

/** Explicitly forward requests while recording finite cloned bodies in the background. */
export function createRecordingFetch(
  forwardFetch: (request: Request) => Promise<Response>,
  options: RecordingFetchOptions = {},
): RecordingFetch {
  const limits = bodyLimits(options)
  const policy = normalizeRedaction(options.redact)
  const times = options.times ?? 1
  validateTiming(times, 0, new Date().toISOString())
  const maxEntries = options.maxEntries ?? 100
  const maxInFlight = options.maxInFlight ?? 8
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxInFlight) || maxInFlight < 1) {
    throw new RangeError('Recording fetch capacity limits must be positive safe integers.')
  }
  const stored = new Map<number, RecordedFixture>()
  const pending = new Map<number, { controller: AbortController, done: Promise<void> }>()
  let issues: RecordingFetchIssue[] = []
  let epoch = 0
  let nextId = 0
  const report = (issue: RecordingFetchIssue, generation: number) => {
    if (epoch === generation) {
      issues.push(issue)
      if (issues.length > maxEntries) {
        issues.shift()
      }
    }
  }
  return {
    async fetch(input, init) {
      const request = input instanceof Request && init === undefined ? input : new Request(input, init)
      const requestId = ++nextId
      const generation = epoch
      if (pending.size >= maxInFlight || stored.size + pending.size >= maxEntries) {
        report({ requestId, code: 'capacity', stage: 'capacity' }, generation)
        return forwardFetch(request)
      }
      const controller = new AbortController()
      const signal = AbortSignal.any([request.signal, controller.signal])
      const startedAt = new Date().toISOString()
      const start = performance.now()
      const metadata = { method: request.method, url: request.url, headers: new Headers(request.headers) }
      // Register the capture before forwarding can consume the request's original body.
      const requestBody = readBody(request, limits, signal)
      const forwarded = Promise.resolve().then(() => forwardFetch(request))
      const capturedRequest = requestBody.catch(() => {
        throw new CaptureFailure('request')
      })
      const capturedResponse = withAbort(forwarded, signal).then(async (response) => {
        try {
          validateResponse(response.status)
          const durationMs = Math.min(2147483647, Math.max(0, performance.now() - start))
          const responseMetadata = { status: response.status, statusText: response.statusText, headers: new Headers(response.headers) }
          // Clone synchronously when headers arrive, before returning the original response to the caller.
          const body = await readBody(response, limits, signal)
          return { metadata: responseMetadata, body, durationMs }
        }
        catch {
          throw new CaptureFailure('response')
        }
      }, () => {
        throw new CaptureFailure('forward')
      })
      const done = Promise.all([capturedRequest, capturedResponse]).then(([requestBytes, response]) => {
        const fixture = fixtureFromBodies(metadata, response.metadata, requestBytes, response.body, {
          ...limits,
          redact: policy,
          times,
          startedAt,
          durationMs: response.durationMs,
        })
        if (epoch === generation) {
          stored.set(requestId, fixture)
        }
      }).catch((error: unknown) => {
        report({ requestId, code: 'capture-failed', stage: error instanceof CaptureFailure ? error.stage : 'redaction' }, generation)
        controller.abort(new DOMException('Recording capture stopped.', 'AbortError'))
      }).finally(() => {
        pending.delete(requestId)
      })
      pending.set(requestId, { controller, done })
      return forwarded
    },
    fixtures: () => [...stored].sort(([left], [right]) => left - right).map(([, fixture]) => structuredClone(fixture)),
    errors: () => structuredClone(issues),
    flush: async () => { await Promise.all([...pending.values()].map(entry => entry.done)) },
    clear() {
      epoch++
      stored.clear()
      issues = []
      for (const entry of pending.values()) {
        entry.controller.abort(new DOMException('Recording was cleared.', 'AbortError'))
      }
      pending.clear()
    },
  }
}
