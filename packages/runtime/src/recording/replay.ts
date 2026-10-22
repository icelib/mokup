import type { RecordedFixture, Replay, ReplayOptions } from './types'
import { bodyLimits, decodeBody, encodeBody, readBody } from './body'
import { validateTiming } from './fixture'
import { normalizeRedaction, redactBody, redactUrl } from './redact'

function delay(ms: number, signals: readonly AbortSignal[]) {
  return new Promise<void>((resolve, reject) => {
    for (const signal of signals) {
      signal.throwIfAborted()
    }
    let timer: ReturnType<typeof setTimeout>
    let onAbort: () => void
    const cleanup = () => {
      clearTimeout(timer)
      for (const signal of signals) {
        signal.removeEventListener('abort', onAbort)
      }
    }
    onAbort = () => {
      cleanup()
      reject(signals.find(signal => signal.aborted)?.reason)
    }
    timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    for (const signal of signals) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/** Replay matching fixtures in input order. Reservations occur before response delays. */
export function createReplay(input: readonly RecordedFixture[], options: ReplayOptions = {}): Replay {
  const { maxBodyBytes } = bodyLimits(options)
  const fixtures = structuredClone(input).map((fixture) => {
    if (fixture.version !== 1) {
      throw new TypeError('Unsupported recording fixture version.')
    }
    validateTiming(fixture.times, fixture.durationMs, fixture.startedAt)
    fixture.redact = normalizeRedaction(fixture.redact)
    const maxEncodedLength = 4 * Math.ceil(maxBodyBytes / 3)
    if ((fixture.request.body?.data.length ?? 0) > maxEncodedLength || (fixture.response.body?.data.length ?? 0) > maxEncodedLength) {
      throw new RangeError(`Replay fixture body exceeds ${maxBodyBytes} bytes.`)
    }
    const requestBody = decodeBody(fixture.request.body)
    const responseBody = decodeBody(fixture.response.body)
    if ((requestBody?.length ?? 0) > maxBodyBytes || (responseBody?.length ?? 0) > maxBodyBytes) {
      throw new RangeError(`Replay fixture body exceeds ${maxBodyBytes} bytes.`)
    }
    // Validate reconstructability before any fixture can be consumed.
    const validation = new Response(responseBody, { status: fixture.response.status, statusText: fixture.response.statusText, headers: fixture.response.headers })
    void validation.body?.cancel().catch(() => undefined)
    return fixture
  })
  let remaining = fixtures.map(fixture => fixture.times)
  let epoch = 0
  let resets = new AbortController()
  return {
    reset: () => {
      remaining = fixtures.map(fixture => fixture.times)
      epoch++
      resets.abort(new Error('Replay was reset while responding to a request.'))
      resets = new AbortController()
    },
    remaining: () => [...remaining],
    handle: async (request) => {
      request.signal.throwIfAborted()
      const generation = epoch
      const resetSignal = resets.signal
      const candidates = fixtures.map((fixture, index) => ({ fixture, index })).filter(({ fixture, index }) =>
        remaining[index]! > 0
        && fixture.request.method === request.method.toUpperCase()
        && fixture.request.url === redactUrl(request.url, fixture.redact),
      )
      if (!candidates.length) {
        return undefined
      }
      const bytes = await readBody(request, options, resetSignal)
      request.signal.throwIfAborted()
      if (epoch !== generation) {
        throw new Error('Replay was reset while matching a request.')
      }
      for (const { fixture, index } of candidates) {
        const body = encodeBody(redactBody(bytes, request.headers.get('content-type') ?? '', fixture.redact, maxBodyBytes))
        if (remaining[index]! < 1 || body?.data !== fixture.request.body?.data || (body === null) !== (fixture.request.body === null)) {
          continue
        }
        remaining[index]!--
        if (options.replayTiming && fixture.durationMs) {
          await delay(fixture.durationMs, [request.signal, resetSignal])
        }
        request.signal.throwIfAborted()
        if (epoch !== generation) {
          throw new Error('Replay was reset while responding to a request.')
        }
        const headers = new Headers(fixture.response.headers)
        // Fetch recording stores decoded bytes; stale framing/compression metadata cannot describe them.
        headers.delete('content-length')
        headers.delete('transfer-encoding')
        headers.delete('content-encoding')
        return new Response(request.method === 'HEAD' ? null : decodeBody(fixture.response.body), {
          status: fixture.response.status,
          statusText: fixture.response.statusText,
          headers,
        })
      }
      return undefined
    },
  }
}
