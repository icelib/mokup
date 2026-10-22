import type { RecordedFixture, RecordingOptions } from '../src/recording'
import { describe, expect, it } from 'vitest'
import { diffRecordedInteractions, recordInteraction } from '../src/recording'

function fixture(value: unknown, options: RecordingOptions = {}, headers: HeadersInit = {}): Promise<RecordedFixture> {
  return recordInteraction(new Request('https://diff.test/items?token=URL_SECRET', {
    headers: { authorization: 'Bearer REQUEST_SECRET', cookie: 'session=COOKIE_SECRET' },
  }), new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json', 'set-cookie': 'session=RESPONSE_SECRET', ...Object.fromEntries(new Headers(headers)) },
  }), options)
}

describe('redacted interaction comparison', () => {
  it('compares JSON structurally and ignores recording metadata and wire framing', async () => {
    const expected = await fixture({ id: 1, label: 'one' }, { startedAt: '2026-10-01', times: 2, durationMs: 10 }, { 'content-length': '100', 'content-encoding': 'gzip' })
    const actual = await fixture({ label: 'one', id: 1 }, { startedAt: '2026-10-05', times: 1, durationMs: 99 })
    const before = JSON.stringify([expected, actual])
    expect(diffRecordedInteractions(expected, actual)).toEqual({ equal: true, differences: [], truncated: false })
    expect(JSON.stringify([expected, actual])).toBe(before)
  })

  it('merges both fixture policies and extra dynamic-field redaction before comparison', async () => {
    const expected = await fixture({ token: 'FIRST_SECRET', updatedAt: 1, value: 42 }, { redact: { jsonPointers: ['/token'], query: ['token'] } }, { date: 'Mon, 05 Oct 2026 00:00:00 GMT' })
    const actual = await fixture({ token: 'SECOND_SECRET', updatedAt: 2, value: 42 }, {}, { date: 'Mon, 05 Oct 2026 00:01:00 GMT' })
    actual.request.url = 'https://diff.test/items?token=OTHER_URL_SECRET'
    actual.request.headers.push(['authorization', 'Bearer OTHER_HEADER_SECRET'])
    expect(diffRecordedInteractions(expected, actual, {
      redact: { headers: ['date'], jsonPointers: ['/updatedAt'] },
    })).toEqual({ equal: true, differences: [], truncated: false })
  })

  it('reports added, removed and changed JSON values with escaped pointer paths', async () => {
    const expected = await fixture({ 'id': 1, 'old': true, 'a/b~c': 1 })
    const actual = await fixture({ 'id': 2, 'added': true, 'a/b~c': 2 })
    actual.response.status = 201
    const result = diffRecordedInteractions(expected, actual)
    expect(result.equal).toBe(false)
    expect(result.differences).toEqual(expect.arrayContaining([
      { path: '/response/status', kind: 'changed', expected: 200, actual: 201 },
      { path: '/response/body/value/id', kind: 'changed', expected: 1, actual: 2 },
      { path: '/response/body/value/old', kind: 'removed', expected: true },
      { path: '/response/body/value/added', kind: 'added', actual: true },
      { path: '/response/body/value/a~1b~0c', kind: 'changed', expected: 1, actual: 2 },
    ]))
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })

  it('redacts changed credentials even when callers provide unredacted fixture headers', async () => {
    const expected = await fixture({ token: 'EXPECTED_SECRET', id: 1 }, { redact: { jsonPointers: ['/token'] } })
    const actual = await fixture({ token: 'ACTUAL_SECRET', id: 2 })
    expected.request.headers = [['authorization', 'EXPECTED_SECRET']]
    actual.request.headers = [['authorization', 'ACTUAL_SECRET']]
    const result = diffRecordedInteractions(expected, actual)
    expect(result.differences).toEqual([{ path: '/response/body/value/id', kind: 'changed', expected: 1, actual: 2 }])
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })

  it('distinguishes binary byte changes and absent versus empty bodies', async () => {
    const binary = (bytes: Uint8Array | null) => recordInteraction(new Request('https://diff.test/binary'), new Response(bytes))
    const expected = await binary(new Uint8Array([0, 255]))
    const actual = await binary(new Uint8Array([0, 128]))
    expect(diffRecordedInteractions(expected, actual).differences).toEqual([
      { path: '/response/body/value', kind: 'changed', expected: btoa('\0\xFF'), actual: btoa('\0\x80') },
    ])
    expect(diffRecordedInteractions(await binary(null), await binary(new Uint8Array())).equal).toBe(false)
  })

  it('bounds body decoding and the number of reported differences', async () => {
    const expected = await fixture({ a: 1, b: 2, c: 3 })
    const actual = await fixture({ a: 2, b: 3, c: 4 })
    const result = diffRecordedInteractions(expected, actual, { maxDifferences: 1 })
    expect(result).toEqual({
      equal: false,
      truncated: true,
      differences: [{ path: '/response/body/value/a', kind: 'changed', expected: 1, actual: 2 }],
    })
    expect(() => diffRecordedInteractions(expected, actual, { maxBodyBytes: 2 })).toThrow('exceeds')
    expect(() => diffRecordedInteractions(expected, actual, { maxDifferences: 0 })).toThrow('positive')
  })
})
