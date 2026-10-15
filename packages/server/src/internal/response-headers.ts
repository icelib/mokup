import type { RuntimeResult } from '@mokup/runtime'

/** Separate authoritative cookie fields from the legacy scalar header view. */
export function resolveResponseHeaders(result: RuntimeResult) {
  if (!result.setCookies) {
    return { headers: result.headers, setCookies: [] as string[] }
  }
  const headers = Object.fromEntries(
    Object.entries(result.headers).filter(([name]) => name.toLowerCase() !== 'set-cookie'),
  )
  return { headers, setCookies: result.setCookies }
}
