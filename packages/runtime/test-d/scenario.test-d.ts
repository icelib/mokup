import { createScenario, createScenarioCatalog } from '@mokup/runtime/scenario'
import { expectType } from 'tsd'

const catalog = createScenarioCatalog({
  happy: createScenario('happy', { status: 200 }),
  error: createScenario('error', { status: 500 }),
})
expectType<readonly string[]>(catalog.names())
expectType<string>(catalog.active())
expectType<{ status: number }>(catalog.current().getState())
expectType<{ status: number }>(catalog.compose('combined', 'happy', 'error').getState())
expectType<typeof catalog>(catalog.fork())
