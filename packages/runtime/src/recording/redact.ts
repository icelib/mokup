import type { RecordingRedaction } from './types'

const secretHeaders = ['authorization', 'proxy-authorization', 'cookie', 'set-cookie']

export function normalizeRedaction(input: RecordingRedaction = {}): RecordingRedaction {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Recording redaction must be an object.')
  }
  for (const name of ['headers', 'query', 'jsonPointers'] as const) {
    const values = input[name]
    if (values !== undefined && (!Array.isArray(values) || values.some(value => typeof value !== 'string'))) {
      throw new TypeError(`Recording redaction ${name} must be an array of strings.`)
    }
  }
  if (input.replacement !== undefined && typeof input.replacement !== 'string') {
    throw new TypeError('Recording redaction replacement must be a string.')
  }
  for (const pointer of input.jsonPointers ?? []) {
    if (pointer !== '' && (!pointer.startsWith('/') || /~(?![01])/u.test(pointer))) {
      throw new TypeError(`Invalid JSON pointer: ${pointer}`)
    }
  }
  return {
    headers: [...new Set([...secretHeaders, ...(input.headers ?? []).map(name => name.toLowerCase())])],
    query: [...(input.query ?? [])],
    jsonPointers: [...(input.jsonPointers ?? [])],
    replacement: input.replacement ?? '[REDACTED]',
  }
}

export function redactHeaders(headers: Headers, policy: RecordingRedaction): Array<[string, string]> {
  const secrets = new Set(policy.headers)
  const result: Array<[string, string]> = []
  headers.forEach((value, name) => {
    if (name !== 'set-cookie') {
      result.push([name, secrets.has(name) ? policy.replacement! : value])
    }
  })
  for (const value of headers.getSetCookie()) {
    result.push(['set-cookie', secrets.has('set-cookie') ? policy.replacement! : value])
  }
  return result
}

export function redactUrl(input: string, policy: RecordingRedaction) {
  const url = new URL(input)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('Recordings support only HTTP and HTTPS URLs.')
  }
  url.username = ''
  url.password = ''
  url.hash = ''
  if (policy.query?.length) {
    const secrets = new Set(policy.query)
    const pairs = [...url.searchParams]
    if (pairs.some(([name]) => secrets.has(name))) {
      url.search = ''
      for (const [name, value] of pairs) {
        url.searchParams.append(name, secrets.has(name) ? policy.replacement! : value)
      }
    }
  }
  return url.href
}

function replacePointer(value: unknown, pointer: string, replacement: string): unknown {
  if (pointer === '') {
    return replacement
  }
  const parts = pointer.slice(1).split('/').map(part => part.replace(/~1/gu, '/').replace(/~0/gu, '~'))
  let target = value
  for (const part of parts.slice(0, -1)) {
    if (target === null || typeof target !== 'object' || !Object.hasOwn(target, part)) {
      return value
    }
    target = (target as Record<string, unknown>)[part]
  }
  const last = parts[parts.length - 1]!
  if (target !== null && typeof target === 'object' && Object.hasOwn(target, last)) {
    Object.defineProperty(target, last, { value: replacement, writable: true, enumerable: true, configurable: true })
  }
  return value
}

export function redactBody(bytes: Uint8Array | null, contentType: string, policy: RecordingRedaction, maxBodyBytes: number) {
  const mimeType = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (bytes === null || !policy.jsonPointers?.length || !(mimeType.endsWith('/json') || mimeType.endsWith('+json'))) {
    return bytes
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  }
  catch {
    throw new TypeError('Cannot redact an invalid JSON body; recording was refused.')
  }
  for (const pointer of policy.jsonPointers) {
    value = replacePointer(value, pointer, policy.replacement!)
  }
  const result = new TextEncoder().encode(JSON.stringify(value))
  if (result.length > maxBodyBytes) {
    throw new RangeError(`Redacted recording body exceeds ${maxBodyBytes} bytes.`)
  }
  return result
}
