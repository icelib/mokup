import type { InjectionKey, Ref } from 'vue'

export interface RequestDecision {
  method: string
  matcher: string
  once: boolean
  result: 'method-mismatch' | 'once-exhausted' | 'matcher-mismatch' | 'matcher-error' | 'matched'
  detail?: string
}

export interface RequestHistoryEntry {
  id: number
  method: string
  path: string
  routeKey: string
  status: number | null
  duration: number
  time: string
  error?: string
  body: string
  contentType: string
  truncated: boolean
  decisionChain?: RequestDecision[]
}

export const requestHistoryKey: InjectionKey<Ref<RequestHistoryEntry[]>> = Symbol('mokup-request-history')

/** Export a bounded, observed response without request credentials or query strings. */
export function exportMockResponse(entry: RequestHistoryEntry, format: 'msw' | 'playwright'): string {
  if (entry.truncated || entry.status === null || entry.error) {
    throw new Error('Only complete successful HTTP responses can be exported.')
  }
  const path = JSON.stringify(entry.path)
  const bodyless = entry.method === 'HEAD' || [204, 205, 304].includes(entry.status)
  const body = bodyless ? null : entry.body
  const headers = entry.contentType ? { 'content-type': entry.contentType } : {}
  const init = JSON.stringify({ status: entry.status, headers }, null, 2)
  if (format === 'msw') {
    return `import { http, HttpResponse } from 'msw'\n\nexport const handlers = [\n  http.all(${path}, ({ request }) => {\n    if (request.method !== ${JSON.stringify(entry.method)}) return\n    return new HttpResponse(${JSON.stringify(body)}, ${init})\n  }),\n]\n`
  }
  return `await context.route(url => url.pathname === ${path}, async (route) => {\n  if (route.request().method() !== ${JSON.stringify(entry.method)}) return route.fallback()\n  await route.fulfill(${JSON.stringify({ status: entry.status, headers, body: body ?? '' }, null, 2)})\n})\n`
}

/** Compare JSON by value; text payloads use a single root change. */
export function diffResponses(before: string, after: string): Array<{ path: string, before: string, after: string }> {
  const changes: Array<{ path: string, before: string, after: string }> = []
  const render = (value: unknown) => value === undefined ? '(missing)' : JSON.stringify(value)
  const compare = (left: unknown, right: unknown, path: string, depth: number) => {
    if (Object.is(left, right) || changes.length >= 100) {
      return
    }
    if (depth < 20 && left && right && typeof left === 'object' && typeof right === 'object' && Array.isArray(left) === Array.isArray(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        compare((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, depth + 1)
      }
    }
    else {
      changes.push({ path: path || '/', before: render(left), after: render(right) })
    }
  }
  try {
    compare(JSON.parse(before), JSON.parse(after), '', 0)
  }
  catch {
    if (before !== after) {
      changes.push({ path: '/', before, after })
    }
  }
  return changes
}
