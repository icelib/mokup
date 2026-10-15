import type { CheckOptions, CheckResult } from 'mokup/cli'
import { checkManifest } from 'mokup/cli'
import { expectType } from 'tsd'

const options: CheckOptions = { dir: 'mock', prefix: '/api', errorOn: 'all' }
expectType<Promise<CheckResult>>(checkManifest(options))
