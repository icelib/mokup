import type { RecordedBody, RecordedFixture, RecordingRedaction } from './types'
import { bodyLimits, decodeBody, encodeBody } from './body'
import { normalizeRedaction, redactBody, redactHeaders, redactUrl } from './redact'

export interface RecordedDifference {
  /** JSON Pointer into the canonical request/response; JSON payloads live under body/value. */
  path: string
  kind: 'added' | 'removed' | 'changed'
  expected?: unknown
  actual?: unknown
}

export interface RecordedInteractionDiff {
  equal: boolean
  differences: RecordedDifference[]
  truncated: boolean
}

export interface RecordedDiffOptions {
  /** Additional rules are merged with both fixtures' redaction rules. */
  redact?: RecordingRedaction
  maxBodyBytes?: number
  /** Maximum retained differences. Defaults to 100. */
  maxDifferences?: number
}

function policyFor(expected: RecordedFixture, actual: RecordedFixture, extra: RecordingRedaction = {}) {
  const policies = [expected.redact, actual.redact, extra].map(normalizeRedaction)
  return normalizeRedaction({
    headers: policies.flatMap(policy => policy.headers ?? []),
    query: policies.flatMap(policy => policy.query ?? []),
    jsonPointers: policies.flatMap(policy => policy.jsonPointers ?? []),
    replacement: extra.replacement ?? '[REDACTED]',
  })
}

function comparisonBody(body: RecordedBody | null, contentType: string, policy: RecordingRedaction, maxBodyBytes: number) {
  if (body === null) {
    return null
  }
  if (body.data.length > 4 * Math.ceil(maxBodyBytes / 3)) {
    throw new RangeError(`Comparison body exceeds ${maxBodyBytes} bytes.`)
  }
  const bytes = decodeBody(body)!
  if (bytes.length > maxBodyBytes) {
    throw new RangeError(`Comparison body exceeds ${maxBodyBytes} bytes.`)
  }
  const redacted = redactBody(bytes, contentType, policy, maxBodyBytes)!
  const mime = contentType.split(';')[0]!.trim().toLowerCase()
  if (mime.endsWith('/json') || mime.endsWith('+json')) {
    try {
      return { kind: 'json', value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(redacted)) as unknown }
    }
    catch {
      throw new TypeError('Comparison requires a valid JSON body for a JSON content type.')
    }
  }
  return { kind: 'base64', value: encodeBody(redacted)!.data }
}

function canonical(fixture: RecordedFixture, policy: RecordingRedaction, maxBodyBytes: number) {
  if (fixture.version !== 1) {
    throw new TypeError('Unsupported recording fixture version.')
  }
  const side = (value: RecordedFixture['request'] | RecordedFixture['response']) => {
    const inputHeaders = new Headers(value.headers)
    const headers: Record<string, string[]> = Object.create(null)
    for (const [name, content] of redactHeaders(inputHeaders, policy)) {
      // Bodies contain Fetch-visible bytes; wire framing cannot describe redacted/canonical JSON.
      if (!['content-length', 'content-encoding', 'transfer-encoding'].includes(name)) {
        (headers[name] ??= []).push(content)
      }
    }
    return { headers, body: comparisonBody(value.body, inputHeaders.get('content-type') ?? '', policy, maxBodyBytes) }
  }
  return {
    request: { method: fixture.request.method.toUpperCase(), url: redactUrl(fixture.request.url, policy), ...side(fixture.request) },
    response: { status: fixture.response.status, statusText: fixture.response.statusText, ...side(fixture.response) },
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** Compare redacted HTTP behavior, excluding recording time, replay counts and wire framing. */
export function diffRecordedInteractions(expected: RecordedFixture, actual: RecordedFixture, options: RecordedDiffOptions = {}): RecordedInteractionDiff {
  const { maxBodyBytes } = bodyLimits(options)
  const maxDifferences = options.maxDifferences ?? 100
  if (!Number.isSafeInteger(maxDifferences) || maxDifferences < 1) {
    throw new RangeError('Comparison maxDifferences must be a positive safe integer.')
  }
  const policy = policyFor(expected, actual, options.redact)
  const differences: RecordedDifference[] = []
  const pending: Array<{ path: string, expected: unknown, actual: unknown, kind: RecordedDifference['kind'] }> = [
    { path: '', expected: canonical(expected, policy, maxBodyBytes), actual: canonical(actual, policy, maxBodyBytes), kind: 'changed' },
  ]
  let truncated = false
  while (pending.length) {
    const entry = pending.pop()!
    if (entry.kind === 'changed' && Object.is(entry.expected, entry.actual)) {
      continue
    }
    if (entry.kind === 'changed' && record(entry.expected) && record(entry.actual)
      && Array.isArray(entry.expected) === Array.isArray(entry.actual)) {
      const keys = [...new Set([...Object.keys(entry.expected), ...Object.keys(entry.actual)])].sort().reverse()
      for (const key of keys) {
        const presentBefore = Object.hasOwn(entry.expected, key)
        const presentAfter = Object.hasOwn(entry.actual, key)
        pending.push({
          path: `${entry.path}/${key.replace(/~/gu, '~0').replace(/\//gu, '~1')}`,
          expected: presentBefore ? entry.expected[key] : undefined,
          actual: presentAfter ? entry.actual[key] : undefined,
          kind: !presentBefore ? 'added' : !presentAfter ? 'removed' : 'changed',
        })
      }
      continue
    }
    if (differences.length === maxDifferences) {
      truncated = true
      break
    }
    differences.push({
      path: entry.path || '/',
      kind: entry.kind,
      ...(entry.kind === 'added' ? {} : { expected: entry.expected }),
      ...(entry.kind === 'removed' ? {} : { actual: entry.actual }),
    })
  }
  return { equal: differences.length === 0, differences, truncated }
}
