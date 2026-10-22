import type { RecordedFixture, RecordingFetchIssue } from '@mokup/runtime/recording'
import { compareLive, createRecordingFetch, diffRecordedInteractions } from '@mokup/runtime/recording'
import { expectType } from 'tsd'

const recorder = createRecordingFetch(fetch, { maxEntries: 10, maxInFlight: 2 })
expectType<Promise<Response>>(recorder.fetch('https://example.test/', { method: 'GET' }))
expectType<Promise<Response>>(recorder.fetch(new Request('https://example.test/')))
expectType<RecordedFixture[]>(recorder.fixtures())
expectType<RecordingFetchIssue[]>(recorder.errors())
expectType<Promise<void>>(recorder.flush())
expectType<void>(recorder.clear())

declare const expected: RecordedFixture
declare const actual: RecordedFixture
const difference = diffRecordedInteractions(expected, actual, { redact: { jsonPointers: ['/timestamp'] } })
expectType<boolean>(difference.equal)
expectType<boolean>(difference.truncated)
expectType<'added' | 'removed' | 'changed' | undefined>(difference.differences[0]?.kind)

const live = compareLive(new Request('https://example.test/'), {
  mock: async () => new Response('mock'),
  real: async () => new Response('real'),
})
expectType<Promise<boolean>>(live.then(result => result.equal))
