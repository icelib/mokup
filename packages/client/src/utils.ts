export type HeaderRecord = Record<string, string>

export const truthyValues = new Set(['1', 'true', 'yes', 'on', 'mock'])
export const falsyValues = new Set(['0', 'false', 'no', 'off', 'real'])
const ABSOLUTE_URL_RE = /^[a-z][a-z\d+.-]*:/i
const PROTOCOL_RELATIVE_ORIGIN_RE = /^\/\/[/\\]*[^/\\?#]+/
const AUTHORITY_PORT_RE = /:(\d+)$/
const TRAILING_SLASH_RE = /\/$/

export function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return undefined
  }
  if (truthyValues.has(normalized)) {
    return true
  }
  if (falsyValues.has(normalized)) {
    return false
  }
  return undefined
}

export function isAbsoluteUrl(value: string): boolean {
  return ABSOLUTE_URL_RE.test(value)
}

export function normalizeHeaders(input?: HeadersInit | null): HeaderRecord {
  const record: HeaderRecord = {}
  if (!input) {
    return record
  }
  if (typeof Headers !== 'undefined' && input instanceof Headers) {
    input.forEach((value, key) => {
      record[key.toLowerCase()] = value
    })
    return record
  }
  if (Array.isArray(input)) {
    if (typeof Headers !== 'undefined') {
      const headers = new Headers(input)
      headers.forEach((value, key) => {
        record[key] = value
      })
      return record
    }
    for (const [key, value] of input) {
      const normalizedKey = String(key).toLowerCase()
      const normalizedValue = String(value)
      record[normalizedKey] = Object.hasOwn(record, normalizedKey)
        ? `${record[normalizedKey]}, ${normalizedValue}`
        : normalizedValue
    }
    return record
  }
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'undefined') {
      continue
    }
    record[key.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value)
  }
  return record
}

export function mergeHeaders(base?: HeaderRecord, next?: HeaderRecord): HeaderRecord {
  return {
    ...(base ?? {}),
    ...(next ?? {}),
  }
}

export function getHeaderValue(headers: HeaderRecord | undefined, key: string): string | undefined {
  if (!headers) {
    return undefined
  }
  return headers[key.toLowerCase()]
}

export function extractSearchParams(url: string): URLSearchParams {
  const hashIndex = url.indexOf('#')
  const trimmed = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const queryIndex = trimmed.indexOf('?')
  if (queryIndex === -1) {
    return new URLSearchParams()
  }
  return new URLSearchParams(trimmed.slice(queryIndex + 1))
}

export function getQueryParam(url: string, key: string): string | undefined {
  const params = extractSearchParams(url)
  const value = params.get(key)
  return value === null ? undefined : value
}

export function appendQueryParam(url: string, key: string, value: string): string {
  const hashIndex = url.indexOf('#')
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex)
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const queryIndex = base.indexOf('?')
  const path = queryIndex === -1 ? base : base.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : base.slice(queryIndex + 1)
  const params = new URLSearchParams(query)
  params.set(key, value)
  const nextQuery = params.toString()
  return `${path}${nextQuery ? `?${nextQuery}` : ''}${hash}`
}

export function normalizePath(pathname: string): string {
  if (!pathname) {
    return '/'
  }
  return pathname.startsWith('/') ? pathname : `/${pathname}`
}

export function joinPaths(prefix: string, path: string): string {
  const normalizedPrefix = normalizePath(prefix)
  const normalizedPath = normalizePath(path)
  if (normalizedPrefix === '/') {
    return normalizedPath
  }
  if (normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`)) {
    return normalizedPath
  }
  return `${normalizedPrefix.replace(TRAILING_SLASH_RE, '')}${normalizedPath}`
}

export interface ParsedUrl {
  isAbsolute: boolean
  origin?: string
  host?: string
  pathname: string
  search: string
  hash: string
}

export function parseUrl(url: string): ParsedUrl {
  const protocolRelativeOrigin = url.match(PROTOCOL_RELATIVE_ORIGIN_RE)?.[0]
  if (protocolRelativeOrigin || isAbsoluteUrl(url)) {
    try {
      const parsed = new URL(protocolRelativeOrigin ? `http:${url}` : url)
      const explicitPort = protocolRelativeOrigin?.match(AUTHORITY_PORT_RE)?.[1]
      return {
        isAbsolute: true,
        origin: protocolRelativeOrigin ?? parsed.origin,
        host: protocolRelativeOrigin
          ? `${parsed.hostname}${explicitPort ? `:${Number(explicitPort)}` : ''}`
          : parsed.host,
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash,
      }
    }
    catch {
      return {
        isAbsolute: false,
        pathname: url || '/',
        search: '',
        hash: '',
      }
    }
  }
  const hashIndex = url.indexOf('#')
  const hash = hashIndex === -1 ? '' : `#${url.slice(hashIndex + 1)}`
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const queryIndex = base.indexOf('?')
  const pathname = queryIndex === -1 ? base : base.slice(0, queryIndex)
  const search = queryIndex === -1 ? '' : `?${base.slice(queryIndex + 1)}`
  return {
    isAbsolute: false,
    pathname: pathname || '/',
    search,
    hash,
  }
}

export function applyPathMap(pathname: string, maps?: Array<{ from: string, to: string }>): string {
  if (!maps || maps.length === 0) {
    return pathname
  }
  const normalizedPath = normalizePath(pathname)
  for (const { from, to } of maps) {
    const normalizedFrom = normalizePath(from)
    const normalizedTo = normalizePath(to)
    const fromHasWildcard = normalizedFrom.endsWith('*')
    const fromPrefix = fromHasWildcard ? normalizedFrom.slice(0, -1) : normalizedFrom
    if (fromHasWildcard) {
      if (!normalizedPath.startsWith(fromPrefix)) {
        continue
      }
      const rest = normalizedPath.slice(fromPrefix.length)
      const toHasWildcard = normalizedTo.endsWith('*')
      const toPrefix = toHasWildcard ? normalizedTo.slice(0, -1) : normalizedTo
      return normalizePath(`${toPrefix}${toHasWildcard ? rest : ''}`)
    }
    if (normalizedPath === fromPrefix) {
      return normalizedTo
    }
  }
  return normalizedPath
}

export function readCookie(cookieHeader: string | undefined, key: string): string | undefined {
  if (!cookieHeader) {
    return undefined
  }
  const parts = cookieHeader.split(';')
  for (const part of parts) {
    const [name, ...rest] = part.trim().split('=')
    if (name === key) {
      return rest.join('=')
    }
  }
  return undefined
}
