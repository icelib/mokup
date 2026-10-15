import type { RouteRule } from './types'

import { loadRules as loadRulesShared } from '@mokup/shared/load-rules'
import { loadModule } from '@mokup/shared/module-loader'

/**
 * Load rules from a mock file (JSON/TS/JS).
 *
 * @param file - Mock file path.
 * @returns Normalized route rules.
 *
 * @example
 * import { loadRules } from '@mokup/cli'
 *
 * const rules = await loadRules('mock/ping.get.ts')
 */
export async function loadRules(file: string, options: { strict?: boolean } = {}): Promise<RouteRule[]> {
  let inputError: string | undefined
  const rules = await loadRulesShared<RouteRule>(file, {
    loadModule,
    ...(options.strict
      ? { logger: { warn: (message: string) => { inputError = message } } }
      : {}),
  })
  if (inputError) {
    throw new Error(inputError)
  }
  return rules
}
