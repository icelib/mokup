import type { ContractResponseDiff } from '../contract/diff'
import type { OpenApiOperation } from '../contract/openapi'
import type { RecordedInteractionDiff } from './diff'
import type { RecordedBody, RecordedFixture, RecordingOptions } from './types'
import { diffOpenApiResponse } from '../contract/diff'
import { bodyLimits, decodeBody, readBody } from './body'
import { diffRecordedInteractions } from './diff'
import { fixtureFromBodies } from './fixture'

export interface LiveComparisonOptions extends Pick<RecordingOptions, 'maxBodyBytes' | 'bodyTimeoutMs' | 'redact'> {
  /** Maximum retained fixture and contract differences. Defaults to 100. */
  maxDifferences?: number
  /** Validate both live responses against this OpenAPI operation when their status and media type agree. */
  contract?: OpenApiOperation
}

export interface LiveComparisonSide {
  readonly fixture?: RecordedFixture
  readonly error?: { readonly message: string }
}

export interface LiveComparisonResult {
  readonly equal: boolean
  /** Redacted request data shared by both invocations. */
  readonly request: RecordedFixture['request']
  readonly mock: LiveComparisonSide
  readonly real: LiveComparisonSide
  readonly diff?: RecordedInteractionDiff
  readonly contract?: ContractResponseDiff
}

export interface LiveComparisonHandlers {
  /** Resolve the request against Mokup. `undefined` means the mock bypassed. */
  mock: (request: Request) => Response | undefined | Promise<Response | undefined>
  /** Resolve the request against the real API. */
  real: (request: Request) => Response | Promise<Response>
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function jsonValue(body: RecordedBody | null, contentType: string): unknown {
  if (body === null) {
    return null
  }
  const bytes = decodeBody(body)
  if (!bytes) {
    return null
  }
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (mime === 'application/json' || mime.endsWith('+json')) {
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    }
    catch {
      return undefined
    }
  }
  return new TextDecoder().decode(bytes)
}

async function capture(
  request: Pick<Request, 'method' | 'url' | 'headers'>,
  requestBytes: Uint8Array | null,
  response: Response | undefined,
  options: LiveComparisonOptions,
): Promise<LiveComparisonSide> {
  if (!response) {
    return { error: { message: 'Mock request bypassed without a response.' } }
  }
  try {
    const responseBytes = await readBody(response, options)
    return { fixture: fixtureFromBodies(request, response, requestBytes, responseBytes, options) }
  }
  catch (error) {
    return { error: { message: message(error) } }
  }
}

function contractDiff(
  operation: OpenApiOperation,
  mock: RecordedFixture,
  real: RecordedFixture,
  maxDifferences: number,
): ContractResponseDiff | undefined {
  const mockType = mock.response.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? ''
  const realType = real.response.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? ''
  const mockMime = mockType.split(';')[0]?.trim().toLowerCase() ?? ''
  const realMime = realType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (mock.response.status !== real.response.status || mockMime !== realMime) {
    return undefined
  }
  return diffOpenApiResponse(
    operation,
    mock.response.status,
    mockType,
    jsonValue(mock.response.body, mockType),
    jsonValue(real.response.body, realType),
    { maxDifferences },
  )
}

function comparisonFixture(fixture: RecordedFixture): RecordedFixture {
  const headers = new Headers(fixture.response.headers)
  const ignored = new Set([
    'date',
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    ...(headers.get('connection') ?? '').split(',').map(name => name.trim().toLowerCase()),
  ])
  return {
    ...fixture,
    response: {
      ...fixture.response,
      // Fetch-created responses and HTTP/2 can omit HTTP/1's reason phrase.
      statusText: '',
      headers: fixture.response.headers.filter(([name]) => !ignored.has(name.toLowerCase())),
    },
  }
}

/**
 * Invoke a mock and a real API with independent request clones and compare their
 * bounded, redacted responses. The original request and both response bodies
 * remain readable by callers; only clones are consumed by the comparator.
 * Ignore response dates, hop-by-hop headers and reason phrases during comparison;
 * the returned fixtures retain this transport metadata for inspection and replay.
 */
export async function compareLive(
  request: Request,
  handlers: LiveComparisonHandlers,
  options: LiveComparisonOptions = {},
): Promise<LiveComparisonResult> {
  const { maxBodyBytes } = bodyLimits(options)
  const maxDifferences = options.maxDifferences ?? 100
  if (!Number.isSafeInteger(maxDifferences) || maxDifferences < 1) {
    throw new RangeError('Live comparison maxDifferences must be a positive safe integer.')
  }
  const requestBytes = await readBody(request, options)
  const requestSample = fixtureFromBodies(request, new Response(null), requestBytes, null, options).request
  const [mockResult, realResult] = await Promise.allSettled([
    Promise.resolve().then(() => handlers.mock(request.clone())),
    Promise.resolve().then(() => handlers.real(request.clone())),
  ])
  const mockCapture: Promise<LiveComparisonSide> = mockResult.status === 'fulfilled'
    ? capture(request, requestBytes, mockResult.value, options)
    : Promise.resolve({ error: { message: message(mockResult.reason) } })
  const realCapture: Promise<LiveComparisonSide> = realResult.status === 'fulfilled'
    ? capture(request, requestBytes, realResult.value, options)
    : Promise.resolve({ error: { message: message(realResult.reason) } })
  const [mock, real] = await Promise.all([mockCapture, realCapture])
  if (!mock.fixture || !real.fixture) {
    return { equal: false, request: requestSample, mock, real }
  }
  const diff = diffRecordedInteractions(comparisonFixture(mock.fixture), comparisonFixture(real.fixture), {
    maxBodyBytes,
    maxDifferences,
    ...(options.redact ? { redact: options.redact } : {}),
  })
  const contract = options.contract ? contractDiff(options.contract, mock.fixture, real.fixture, maxDifferences) : undefined
  return {
    equal: diff.equal && (contract?.equal ?? true),
    request: requestSample,
    mock,
    real,
    diff,
    ...(contract ? { contract } : {}),
  }
}
