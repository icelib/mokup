import type { PreviewServer, ViteDevServer } from 'vite'
import type { FileRouteRule, Logger } from './shared/types'

import { loadRules as loadRulesShared } from '@mokup/shared/load-rules'
import { loadModule, loadModuleWithVite } from './module-loader'

/**
 * Load route rules from a mock file.
 *
 * @param file - Mock file path.
 * @param server - Optional Vite server for SSR module loading.
 * @param logger - Logger for parse warnings.
 * @returns Normalized route rules.
 *
 * @example
 * import { loadRules } from 'mokup/vite'
 *
 * const rules = await loadRules('/project/mock/ping.get.ts', undefined, console)
 */
export async function loadRules(
  file: string,
  server: ViteDevServer | PreviewServer | undefined,
  logger: Logger,
): Promise<FileRouteRule[]> {
  const moduleLoader = server
    ? (entry: string) => loadModuleWithVite(server, entry)
    : (entry: string) => loadModule(entry)
  return loadRulesShared<FileRouteRule>(file, { loadModule: moduleLoader, logger })
}
