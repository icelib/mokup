import type { PassthroughResult, responseBodyType, StrictResponse } from './types'
import { captureResponseCookies, getResponseCookies } from './response-cookies'

export type HttpResponseType = 'basic' | 'cors' | 'default' | 'error' | 'opaque' | 'opaqueredirect'
export interface HttpResponseInit extends ResponseInit {
  /** Accepted for MSW compatibility; Fetch computes the response type. */
  type?: HttpResponseType
}

function withType(init: HttpResponseInit | undefined, type: string): ResponseInit {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type')) {
    headers.set('content-type', type)
  }
  return { ...init, headers }
}

export class HttpResponse<Body = unknown> extends Response {
  declare readonly [responseBodyType]: Body

  constructor(body?: BodyInit | null, init?: HttpResponseInit) {
    super(body, init)
    captureResponseCookies(this, init?.headers)
  }

  override json(): Promise<Body> {
    return super.json() as Promise<Body>
  }

  override clone(): HttpResponse<Body> {
    const response = super.clone()
    const headers = new Headers(response.headers)
    headers.delete('set-cookie')
    for (const cookie of getResponseCookies(this)) {
      headers.append('set-cookie', cookie)
    }
    return new HttpResponse<Body>(response.body, { status: response.status, statusText: response.statusText, headers })
  }

  static override json<Body>(body?: Body | null, init?: HttpResponseInit): HttpResponse<Body> {
    const serialized = body === undefined ? null : JSON.stringify(body)
    if (serialized === undefined) {
      throw new TypeError('The supplied value cannot be serialized as JSON.')
    }
    return new HttpResponse<Body>(serialized, withType(init, 'application/json'))
  }

  static text<Body extends string>(body?: Body | null, init?: HttpResponseInit): HttpResponse<Body> {
    return new HttpResponse<Body>(body, withType(init, 'text/plain; charset=utf-8'))
  }

  static html<Body extends string>(body?: Body | null, init?: HttpResponseInit): HttpResponse<Body> {
    return new HttpResponse<Body>(body, withType(init, 'text/html; charset=utf-8'))
  }

  static xml<Body extends string>(body?: Body | null, init?: HttpResponseInit): HttpResponse<Body> {
    return new HttpResponse<Body>(body, withType(init, 'application/xml'))
  }

  static arrayBuffer(body?: ArrayBuffer | SharedArrayBuffer | ArrayBufferView, init?: HttpResponseInit): HttpResponse {
    if (body === undefined) {
      return new HttpResponse(null, withType(init, 'application/octet-stream'))
    }
    const bytes = ArrayBuffer.isView(body)
      ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
      : new Uint8Array(body)
    return new HttpResponse(new Uint8Array(bytes), withType(init, 'application/octet-stream'))
  }

  static formData(body?: FormData | null, init?: HttpResponseInit): HttpResponse {
    return new HttpResponse(body, init)
  }

  /** Create a standards-compliant redirect response with a typed body. */
  static override redirect(url: string | URL, status = 302): HttpResponse<never> {
    const response = Response.redirect(url, status)
    return new HttpResponse<never>(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  static override error(): StrictResponse<never> {
    return Response.error() as StrictResponse<never>
  }
}

const bypassResult: PassthroughResult = Object.freeze({ kind: 'mokup:passthrough' })

/** Stop handler lookup and send the original request through its transport. */
export function passthrough(): PassthroughResult {
  return bypassResult
}

/** Ask the transport to fail the request without an HTTP response. */
export function networkError(): StrictResponse<never> {
  return HttpResponse.error()
}

export function delay(duration: number | 'real' | 'infinite' = 'real', options: { signal?: AbortSignal } = {}): Promise<void> {
  const { signal } = options
  const milliseconds = duration === 'real' ? 100 + Math.floor(Math.random() * 301) : duration
  if (typeof milliseconds === 'number' && (!Number.isFinite(milliseconds) || milliseconds < 0)) {
    return Promise.reject(new RangeError('Delay must be a non-negative finite number.'))
  }
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: () => void
    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      signal?.removeEventListener('abort', onAbort)
    }
    onAbort = () => {
      cleanup()
      reject(signal?.reason)
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (typeof milliseconds === 'number') {
      timer = setTimeout(() => {
        cleanup()
        resolve()
      }, milliseconds)
    }
  })
}
