import type { RecordedBody, RecordedFixture, RecordingOptions, RecordingRedaction } from './types'
import { bodyLimits, decodeBody, encodeBody } from './body'
import { validateTiming } from './fixture'
import { normalizeRedaction, redactBody, redactHeaders, redactUrl } from './redact'

interface HarHeader {
  name: string
  value: string
}

export interface HarEntry {
  startedDateTime: string
  time: number
  request: {
    method: string
    url: string
    httpVersion: string
    headers: HarHeader[]
    queryString: HarHeader[]
    cookies: unknown[]
    headersSize: number
    bodySize: number
    postData?: { mimeType: string, text: string, _encoding?: 'base64' }
  }
  response: {
    status: number
    statusText: string
    httpVersion: string
    headers: HarHeader[]
    cookies: unknown[]
    redirectURL: string
    headersSize: number
    bodySize: number
    content: { size: number, mimeType: string, text?: string, encoding?: 'base64' }
  }
  cache: Record<string, never>
  timings: { send: number, wait: number, receive: number }
  /** HAR has no standard binary request encoding or repeat count. */
  _mokup?: { version: 1, times: number, redact: RecordingRedaction, responseBodyPresent: boolean }
}

export interface HarArchive {
  log: {
    version: '1.2'
    creator: { name: string, version: string }
    entries: HarEntry[]
  }
}

function headerList(headers: Array<[string, string]>): HarHeader[] {
  return headers.map(([name, value]) => ({ name, value }))
}

/** Export HTTP HAR 1.2; binary request bodies use the documented postData._encoding extension. */
export function exportHar(fixtures: readonly RecordedFixture[]): HarArchive {
  return {
    log: {
      version: '1.2',
      creator: { name: 'mokup', version: '1' },
      entries: fixtures.map((fixture) => {
        const requestBytes = decodeBody(fixture.request.body)
        const responseBytes = decodeBody(fixture.response.body)
        const requestHeaders = new Headers(fixture.request.headers)
        const responseHeaders = new Headers(fixture.response.headers)
        return {
          startedDateTime: fixture.startedAt,
          time: fixture.durationMs,
          request: {
            method: fixture.request.method,
            url: fixture.request.url,
            httpVersion: 'HTTP/1.1',
            headers: headerList(fixture.request.headers),
            queryString: [...new URL(fixture.request.url).searchParams].map(([name, value]) => ({ name, value })),
            cookies: [],
            headersSize: -1,
            bodySize: requestBytes?.length ?? 0,
            ...(fixture.request.body === null
              ? {}
              : {
                  postData: {
                    mimeType: requestHeaders.get('content-type') ?? 'application/octet-stream',
                    text: fixture.request.body.data,
                    _encoding: 'base64' as const,
                  },
                }),
          },
          response: {
            status: fixture.response.status,
            statusText: fixture.response.statusText,
            httpVersion: 'HTTP/1.1',
            headers: headerList(fixture.response.headers),
            cookies: [],
            redirectURL: responseHeaders.get('location') ?? '',
            headersSize: -1,
            bodySize: responseBytes?.length ?? 0,
            content: {
              size: responseBytes?.length ?? 0,
              mimeType: responseHeaders.get('content-type') ?? 'application/octet-stream',
              ...(fixture.response.body === null ? {} : { text: fixture.response.body.data, encoding: 'base64' as const }),
            },
          },
          cache: {},
          timings: { send: 0, wait: fixture.durationMs, receive: 0 },
          _mokup: {
            version: 1,
            times: fixture.times,
            redact: structuredClone(fixture.redact),
            responseBodyPresent: fixture.response.body !== null,
          },
        }
      }),
    },
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid HAR ${label}.`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Invalid HAR ${label}.`)
  }
  return value
}

function headers(value: unknown): Headers {
  if (!Array.isArray(value)) {
    throw new TypeError('HAR headers must be an array.')
  }
  const result = new Headers()
  for (const item of value) {
    const header = object(item, 'header')
    result.append(string(header['name'], 'header name'), string(header['value'], 'header value'))
  }
  return result
}

function contentBody(text: unknown, encoding: unknown, maxBodyBytes: number): RecordedBody {
  const value = string(text, 'body text')
  if (encoding !== undefined && encoding !== 'base64') {
    throw new TypeError('Unsupported HAR body encoding.')
  }
  // Bound allocation before decoding untrusted HAR strings.
  if (value.length > (encoding === 'base64' ? 4 * Math.ceil(maxBodyBytes / 3) + 4 : maxBodyBytes)) {
    throw new RangeError(`HAR body exceeds ${maxBodyBytes} bytes.`)
  }
  const bytes = encoding === 'base64'
    ? decodeBody({ encoding: 'base64', data: value })!
    : new TextEncoder().encode(value)
  if (bytes.length > maxBodyBytes) {
    throw new RangeError(`HAR body exceeds ${maxBodyBytes} bytes.`)
  }
  return encodeBody(bytes)!
}

/** Import finite, body-bearing HTTP HAR entries. Missing captured bodies fail explicitly. */
export function importHar(input: unknown, options: RecordingOptions = {}): RecordedFixture[] {
  const { maxBodyBytes } = bodyLimits(options)
  const log = object(object(input, 'archive')['log'], 'log')
  if (log['version'] !== '1.2' || !Array.isArray(log['entries'])) {
    throw new TypeError('Expected HAR 1.2 with an entries array.')
  }
  return log['entries'].map((inputEntry: unknown) => {
    const entry = object(inputEntry, 'entry')
    const request = object(entry['request'], 'request')
    const response = object(entry['response'], 'response')
    const content = object(response['content'], 'response content')
    const extension = entry['_mokup'] === undefined ? undefined : object(entry['_mokup'], 'Mokup extension')
    if (extension && extension['version'] !== 1) {
      throw new TypeError('Unsupported Mokup HAR extension version.')
    }
    const redact = normalizeRedaction({
      ...(extension?.['redact'] === undefined ? {} : object(extension['redact'], 'redaction')),
      ...options.redact,
    })
    const requestHeaders = headers(request['headers'])
    const responseHeaders = headers(response['headers'])
    const method = string(request['method'], 'method').toUpperCase()
    const url = redactUrl(string(request['url'], 'URL'), redact)
    let requestBody: RecordedBody | null = null
    if (request['postData'] !== undefined) {
      const data = object(request['postData'], 'postData')
      requestBody = contentBody(data['text'], data['_encoding'], maxBodyBytes)
      if (extension === undefined && !requestHeaders.has('content-type') && typeof data['mimeType'] === 'string') {
        requestHeaders.set('content-type', data['mimeType'])
      }
    }
    else if (typeof request['bodySize'] === 'number' && request['bodySize'] > 0) {
      throw new TypeError('HAR request body was not captured.')
    }
    let responseBody: RecordedBody | null = null
    if (content['text'] !== undefined) {
      responseBody = contentBody(content['text'], content['encoding'], maxBodyBytes)
    }
    else if ((typeof content['size'] === 'number' && content['size'] > 0) || extension?.['responseBodyPresent'] === true) {
      throw new TypeError('HAR response body was not captured.')
    }
    if (extension === undefined && !responseHeaders.has('content-type') && typeof content['mimeType'] === 'string') {
      responseHeaders.set('content-type', content['mimeType'])
    }
    const status = response['status']
    if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 599) {
      throw new TypeError('HAR responses must have a Fetch-compatible HTTP status (200–599).')
    }
    if ((method === 'HEAD' || [204, 205, 304].includes(status)) && responseBody !== null) {
      if (decodeBody(responseBody)!.length > 0) {
        throw new TypeError('HAR contains a body for a bodyless HTTP response.')
      }
      responseBody = null
    }
    if (['GET', 'HEAD'].includes(method) && requestBody !== null) {
      throw new TypeError('HAR contains a request body unsupported by Fetch.')
    }
    const times = options.times ?? extension?.['times'] ?? 1
    const durationMs = options.durationMs ?? entry['time']
    const startedAt = options.startedAt ?? string(entry['startedDateTime'], 'startedDateTime')
    if (typeof times !== 'number' || typeof durationMs !== 'number') {
      throw new TypeError('Invalid HAR timing or repeat count.')
    }
    validateTiming(times, durationMs, startedAt)
    return {
      version: 1,
      startedAt,
      durationMs,
      times,
      redact,
      request: {
        method,
        url,
        headers: redactHeaders(requestHeaders, redact),
        body: encodeBody(redactBody(decodeBody(requestBody), requestHeaders.get('content-type') ?? '', redact, maxBodyBytes)),
      },
      response: {
        status,
        statusText: string(response['statusText'], 'statusText'),
        headers: redactHeaders(responseHeaders, redact),
        body: encodeBody(redactBody(decodeBody(responseBody), responseHeaders.get('content-type') ?? '', redact, maxBodyBytes)),
      },
    }
  })
}
