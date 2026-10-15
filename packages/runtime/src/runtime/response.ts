import type { ManifestRoute, RuntimeResult } from '../types'
import { applyResponseOverrides } from '@mokup/shared/response-overrides'

const TEXT_APPLICATION_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/json',
  'application/json-seq',
  'application/ndjson',
  'application/x-ndjson',
  'application/xml',
  'application/xml-dtd',
  'application/x-ecmascript',
  'application/x-javascript',
  'application/x-www-form-urlencoded',
])

function shouldTreatAsText(contentType: string) {
  const normalized = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return !normalized
    || normalized.startsWith('text/')
    || normalized.endsWith('+json')
    || normalized.endsWith('+xml')
    || TEXT_APPLICATION_TYPES.has(normalized)
}

async function toRuntimeResult(response: Response): Promise<RuntimeResult> {
  const entries: Array<[string, string]> = []
  response.headers.forEach((value, key) => {
    entries.push([key.toLowerCase(), value])
  })
  const headers: Record<string, string> = Object.fromEntries(entries)
  const setCookies = response.headers.getSetCookie?.() ?? []
  if (setCookies.length) {
    headers['set-cookie'] = setCookies[setCookies.length - 1]!
  }
  const result: RuntimeResult = {
    status: response.status,
    headers,
    body: null,
    ...(setCookies.length > 1 ? { setCookies } : {}),
  }

  if (!response.body || [204, 205, 304].includes(response.status)) {
    return result
  }

  const contentType = headers['content-type'] ?? ''
  result.body = shouldTreatAsText(contentType)
    ? await response.text()
    : new Uint8Array(await response.arrayBuffer())
  return result
}

function applyRouteOverrides(response: Response, route: ManifestRoute, method?: string) {
  return applyResponseOverrides(response, route, method)
}

function resolveResponse(value: unknown, fallback: Response) {
  if (value instanceof Response) {
    return value
  }
  if (value && typeof value === 'object' && 'res' in value) {
    const resolved = (value as { res?: unknown }).res
    if (resolved instanceof Response) {
      return resolved
    }
  }
  return fallback
}

export { applyRouteOverrides, resolveResponse, toRuntimeResult }
