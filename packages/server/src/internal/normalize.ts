const ABSOLUTE_HTTP_URL_RE = /^https?:\/\//

/**
 * Normalize URLSearchParams into a record.
 *
 * @param params - URLSearchParams instance.
 * @returns Query record.
 *
 * @example
 * import { normalizeQuery } from '@mokup/server'
 *
 * const query = normalizeQuery(new URLSearchParams('a=1&a=2'))
 */
export function normalizeQuery(
  params: URLSearchParams,
): Record<string, string | string[]> {
  const query = new Map<string, string | string[]>()
  for (const [key, value] of params.entries()) {
    const current = query.get(key)
    if (typeof current === 'undefined') {
      query.set(key, value)
    }
    else if (Array.isArray(current)) {
      current.push(value)
    }
    else {
      query.set(key, [current, value])
    }
  }
  return Object.fromEntries(query)
}

/**
 * Normalize fetch Headers into a lowercase record.
 *
 * @param headers - Headers instance.
 * @returns Header record.
 *
 * @example
 * import { normalizeHeaders } from '@mokup/server'
 *
 * const record = normalizeHeaders(new Headers({ 'X-Test': '1' }))
 */
export function normalizeHeaders(
  headers: Headers,
): Record<string, string> {
  return Object.fromEntries(Array.from(headers, ([key, value]) => [key.toLowerCase(), value]))
}

/**
 * Normalize Node headers into a lowercase record.
 *
 * @param headers - Node header record.
 * @returns Header record.
 *
 * @example
 * import { normalizeNodeHeaders } from '@mokup/server'
 *
 * const record = normalizeNodeHeaders({ 'X-Test': '1' })
 */
export function normalizeNodeHeaders(
  headers?: Record<string, string | string[] | undefined>,
): Record<string, string> {
  if (!headers) {
    return {}
  }
  return Object.fromEntries(Object.entries(headers).flatMap(([key, value]) => typeof value === 'undefined'
    ? []
    : [[key.toLowerCase(), Array.isArray(value) ? value.join(',') : String(value)]]))
}

/**
 * Resolve an input URL using request headers as a base.
 *
 * @param input - Request URL or path.
 * @param headers - Headers with optional host.
 * @returns Resolved URL.
 *
 * @example
 * import { resolveUrl } from '@mokup/server'
 *
 * const url = resolveUrl('/api/ping', { host: 'localhost:3000' })
 */
export function resolveUrl(
  input: string,
  headers: Record<string, string> & { host?: string },
): URL {
  if (ABSOLUTE_HTTP_URL_RE.test(input)) {
    return new URL(input)
  }
  const host = headers.host
  const base = host ? `http://${host}` : 'http://localhost'
  return new URL(input, base)
}
