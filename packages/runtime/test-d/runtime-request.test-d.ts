import type { RuntimeRequest } from '@mokup/runtime'
import { Buffer } from 'node:buffer'
import { expectAssignable, expectNotAssignable, expectType } from 'tsd'

const legacy: RuntimeRequest = {
  method: 'POST',
  path: '/binary',
  query: {},
  headers: {},
  rawBody: 'text',
  body: { parsed: true },
}

expectType<string | undefined>(legacy.rawBody)
expectType<unknown>(legacy.body)
expectType<Uint8Array | undefined>(legacy.rawBodyBytes)
expectAssignable<RuntimeRequest>({ ...legacy, rawBodyBytes: new Uint8Array([0, 255]) })
expectAssignable<RuntimeRequest>({ ...legacy, rawBodyBytes: Buffer.from([0, 255]) })
expectAssignable<RuntimeRequest>({ ...legacy, rawBodyBytes: new Uint8Array(new SharedArrayBuffer(2)) })
expectNotAssignable<RuntimeRequest>({ ...legacy, rawBodyBytes: 'bytes' })
