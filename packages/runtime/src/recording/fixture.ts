import type { RecordedFixture, RecordingOptions } from './types'
import { bodyLimits, encodeBody } from './body'
import { normalizeRedaction, redactBody, redactHeaders, redactUrl } from './redact'

export function validateTiming(times: number, durationMs: number, startedAt: string) {
  if (!Number.isSafeInteger(times) || times < 1 || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 2147483647
    || !Number.isFinite(Date.parse(startedAt))) {
    throw new RangeError('Fixtures require positive integer times, finite nonnegative duration and a valid startedAt date.')
  }
}

export function validateResponse(status: number) {
  if (status < 200 || status > 599) {
    throw new TypeError('Opaque, error and informational responses cannot be recorded for Fetch replay.')
  }
}

/** Shared recording boundary for body readers and the forwarding fetch wrapper. */
export function fixtureFromBodies(
  request: Pick<Request, 'method' | 'url' | 'headers'>,
  response: Pick<Response, 'status' | 'statusText' | 'headers'>,
  requestBytes: Uint8Array | null,
  responseBytes: Uint8Array | null,
  options: RecordingOptions,
): RecordedFixture {
  const { maxBodyBytes } = bodyLimits(options)
  const redact = normalizeRedaction(options.redact)
  const times = options.times ?? 1
  const durationMs = options.durationMs ?? 0
  const startedAt = options.startedAt ?? new Date().toISOString()
  validateTiming(times, durationMs, startedAt)
  validateResponse(response.status)
  const requestBody = redactBody(requestBytes, request.headers.get('content-type') ?? '', redact, maxBodyBytes)
  const responseBody = redactBody(responseBytes, response.headers.get('content-type') ?? '', redact, maxBodyBytes)
  return {
    version: 1,
    startedAt,
    durationMs,
    times,
    redact,
    request: { method: request.method.toUpperCase(), url: redactUrl(request.url, redact), headers: redactHeaders(request.headers, redact), body: encodeBody(requestBody) },
    response: { status: response.status, statusText: response.statusText, headers: redactHeaders(response.headers, redact), body: encodeBody(responseBody) },
  }
}
