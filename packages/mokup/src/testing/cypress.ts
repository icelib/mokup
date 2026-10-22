import type { HttpHandler, MockSession, UnhandledRequestPolicy } from '@mokup/runtime/http'
import { createMockSession } from '@mokup/runtime/http'

export interface CypressRequest {
  method: string
  url: string
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
  reply: (response?: CypressResponse) => void
  continue: () => void
}

export interface CypressResponse {
  statusCode: number
  headers: Record<string, string | string[]>
  body: unknown
}

export interface CypressMockOptions {
  handlers?: readonly HttpHandler[]
  onUnhandled?: UnhandledRequestPolicy
}

export interface CypressMockController {
  handle: (request: CypressRequest) => Promise<void>
  errors: () => readonly Error[]
  dispose: () => Promise<void>
  session: MockSession
}

function requestBody(value: unknown): BodyInit | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'string' || value instanceof ArrayBuffer || value instanceof Blob || value instanceof FormData || value instanceof URLSearchParams) {
    return value
  }
  if (value instanceof Uint8Array) {
    return value as unknown as BodyInit
  }
  return JSON.stringify(value)
}

async function responseBody(response: Response): Promise<unknown> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (contentType === 'application/json' || contentType.endsWith('+json')) {
    const text = new TextDecoder().decode(bytes)
    try {
      return JSON.parse(text) as unknown
    }
    catch {
      return text
    }
  }
  return bytes
}

function requestHeaders(input: CypressRequest['headers']): Headers | undefined {
  if (!input) {
    return undefined
  }
  const headers = new Headers()
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) {
      continue
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, item)
    }
  }
  return headers
}

/** Adapt a Cypress `cy.intercept` callback to the shared Mokup HTTP session. */
export function createCypressInterceptor(options: CypressMockOptions = {}): CypressMockController {
  const session = createMockSession({
    handlers: options.handlers ?? [],
    ...(options.onUnhandled === undefined ? {} : { onUnhandled: options.onUnhandled }),
  })
  const failures: Error[] = []
  let disposed = false
  return {
    session,
    async handle(input) {
      if (disposed) {
        input.continue()
        return
      }
      try {
        const body = requestBody(input.body)
        const inputHeaders = requestHeaders(input.headers)
        const response = await session.handle(new Request(input.url, {
          method: input.method,
          ...(inputHeaders === undefined ? {} : { headers: inputHeaders }),
          ...(body === undefined ? {} : { body }),
        }))
        if (!response) {
          input.continue()
          return
        }
        const headers: Record<string, string | string[]> = {}
        response.headers.forEach((value, key) => {
          if (!['content-length', 'transfer-encoding', 'content-encoding'].includes(key)) {
            headers[key] = value
          }
        })
        input.reply({ statusCode: response.status, headers, body: await responseBody(response) })
      }
      catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        failures.push(error)
        throw error
      }
    },
    errors: () => [...failures],
    async dispose() {
      if (disposed) {
        return
      }
      disposed = true
      await session.dispose()
    },
  }
}
