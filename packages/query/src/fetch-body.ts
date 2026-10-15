import type { MokupFetchInit } from '@mokup/client'

function isPlainObjectBody(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype === null) {
    return true
  }
  if (Object.getPrototypeOf(prototype) !== null) {
    return false
  }
  // Compare constructors across realms without accepting class instances or BodyInit objects.
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value
  return typeof constructor === 'function'
    && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object)
}

export function prepareFetchBody(body: unknown, headers?: HeadersInit): Pick<MokupFetchInit, 'body' | 'headers'> {
  if (!Array.isArray(body) && !isPlainObjectBody(body)) {
    return {
      ...(headers ? { headers } : {}),
      ...(typeof body !== 'undefined' ? { body: body as BodyInit | null } : {}),
    }
  }

  const encoded = JSON.stringify(body)
  if (typeof encoded === 'undefined') {
    return headers ? { headers } : {}
  }
  const jsonHeaders = new Headers(headers)
  if (!jsonHeaders.has('content-type')) {
    jsonHeaders.set('content-type', 'application/json')
  }
  return { body: encoded, headers: jsonHeaders }
}
