import type { FileRouteRule, Logger } from './types'

import { loadRules as loadRulesShared } from '@mokup/shared/load-rules'
import { loadModule } from '@mokup/shared/module-loader'

export async function loadRules(
  file: string,
  logger: Logger,
): Promise<FileRouteRule[]> {
  return loadRulesShared<FileRouteRule>(file, { loadModule, logger })
}
