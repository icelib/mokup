import type { BodyReadableStream } from '@mokup/shared/stream-body'
import type { IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'
import { readStreamBody, withStreamLifecycle } from '@mokup/shared/stream-body'
import { expectAssignable, expectType } from 'tsd'

declare const request: IncomingMessage
const minimalStream = { on: (_event: string, _listener: (...args: unknown[]) => void) => {} }

expectAssignable<BodyReadableStream>(request)
expectAssignable<BodyReadableStream>(new PassThrough())
expectAssignable<BodyReadableStream>(minimalStream)
expectType<Promise<Uint8Array | null>>(readStreamBody(minimalStream))
expectType<Promise<boolean>>(withStreamLifecycle(request, async () => true))
expectType<Promise<number>>(withStreamLifecycle(minimalStream, () => 1))
