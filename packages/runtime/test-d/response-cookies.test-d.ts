import type { RuntimeResult } from '@mokup/runtime'
import { expectAssignable, expectType } from 'tsd'

const legacy: RuntimeResult = { status: 200, headers: { 'set-cookie': 'session=one' }, body: 'ok' }
const multiple: RuntimeResult = {
  status: 200,
  headers: { 'set-cookie': 'theme=dark' },
  setCookies: ['session=one; Expires=Wed, 21 Oct 2037 07:28:00 GMT', 'theme=dark'],
  body: new Uint8Array([0, 255]),
}

expectAssignable<RuntimeResult>(legacy)
expectType<Record<string, string>>(multiple.headers)
expectType<string[] | undefined>(multiple.setCookies)
