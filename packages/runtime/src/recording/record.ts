import type { RecordedFixture, RecordingOptions } from './types'
import { bodyLimits, readBody } from './body'
import { fixtureFromBodies, validateResponse, validateTiming } from './fixture'
import { normalizeRedaction, redactUrl } from './redact'

/** Record finite HTTP bodies without consuming either original Request or Response. */
export async function recordInteraction(request: Request, response: Response, options: RecordingOptions = {}): Promise<RecordedFixture> {
  bodyLimits(options)
  const redact = normalizeRedaction(options.redact)
  const times = options.times ?? 1
  const durationMs = options.durationMs ?? 0
  const startedAt = options.startedAt ?? new Date().toISOString()
  validateTiming(times, durationMs, startedAt)
  validateResponse(response.status)
  redactUrl(request.url, redact)
  const requestBytes = await readBody(request, options)
  const responseBytes = await readBody(response, options, request.signal)
  return fixtureFromBodies(request, response, requestBytes, responseBytes, { ...options, redact, times, durationMs, startedAt })
}
