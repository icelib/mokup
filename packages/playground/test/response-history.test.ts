import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { diffResponses, exportMockResponse } from '../src/hooks/playground-request/history'

describe('response history comparison', () => {
  it('ignores property order and reports added, removed and nested values', () => {
    expect(diffResponses('{"a":1,"b":2}', '{"b":2,"a":1}')).toEqual([])
    expect(diffResponses('{"user":{"name":"Ada"},"old":true}', '{"user":{"name":"Lin"},"new":0}')).toEqual([
      { path: '/user/name', before: '"Ada"', after: '"Lin"' },
      { path: '/old', before: 'true', after: '(missing)' },
      { path: '/new', before: '(missing)', after: '0' },
    ])
  })

  it('escapes JSON pointers, handles plain text and bounds large comparisons', () => {
    expect(diffResponses('{"a/b~":1}', '{"a/b~":2}')[0]?.path).toBe('/a~1b~0')
    expect(diffResponses('old text', 'new text')).toEqual([{ path: '/', before: 'old text', after: 'new text' }])
    expect(diffResponses(JSON.stringify(Array.from({ length: 1000 }).fill(0)), JSON.stringify(Array.from({ length: 1000 }).fill(1)))).toHaveLength(100)
  })

  it('exports runnable responses and rejects incomplete snapshots', async () => {
    const entry = { id: 1, method: 'GET', path: '/hello', routeKey: 'GET /hello', status: 200, duration: 1, time: '', body: 'quote " and newline\n', contentType: 'text/plain', truncated: false }
    const playwright = exportMockResponse(entry, 'playwright')
    let callback: ((route: unknown) => Promise<void>) | undefined
    const context = { route: async (_matcher: unknown, handler: typeof callback) => {
      callback = handler
    } }
    // Execute the exported snippet to verify escaping and preserved response data.
    await runInNewContext(`(async () => { ${playwright} })()`, { context })
    let response: unknown
    await callback!({ request: () => ({ method: () => 'GET' }), fulfill: async (value: unknown) => {
      response = value
    } })
    expect(response).toEqual({ status: 200, headers: { 'content-type': 'text/plain' }, body: entry.body })
    expect(exportMockResponse({ ...entry, status: 204, body: '' }, 'msw')).toContain('new HttpResponse(null,')
    expect(() => exportMockResponse({ ...entry, truncated: true }, 'msw')).toThrow('complete')
  })
})
