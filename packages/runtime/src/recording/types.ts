/** Additional secrets to redact; default sensitive HTTP headers always remain redacted. */
export interface RecordingRedaction {
  headers?: readonly string[]
  query?: readonly string[]
  /** RFC 6901 pointers, applied to JSON request and response bodies. */
  jsonPointers?: readonly string[]
  replacement?: string
}

export interface RecordingOptions {
  /** Maximum bytes per body, before and after redaction. Defaults to 1 MiB. */
  maxBodyBytes?: number
  /** Total time allowed to read each finite body. Defaults to 5000 ms. */
  bodyTimeoutMs?: number
  redact?: RecordingRedaction
  /** Response delay reproduced only when replayTiming is enabled. */
  durationMs?: number
  /** Fixture consumes this many matching requests. Defaults to 1. */
  times?: number
  startedAt?: string
}

export interface RecordedBody {
  encoding: 'base64'
  data: string
}

export interface RecordedFixture {
  version: 1
  startedAt: string
  durationMs: number
  times: number
  redact: RecordingRedaction
  request: {
    method: string
    url: string
    headers: Array<[string, string]>
    body: RecordedBody | null
  }
  response: {
    status: number
    statusText: string
    headers: Array<[string, string]>
    body: RecordedBody | null
  }
}

export interface ReplayOptions {
  maxBodyBytes?: number
  bodyTimeoutMs?: number
  replayTiming?: boolean
}

export interface Replay {
  /** Matches exact normalized method, URL and redacted body; misses return undefined. */
  handle: (request: Request) => Promise<Response | undefined>
  reset: () => void
  /** Remaining uses in fixture order. Each replay instance owns its counters. */
  remaining: () => number[]
}
