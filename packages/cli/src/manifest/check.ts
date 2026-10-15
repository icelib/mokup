import type { CheckDiagnostic, CheckOptions, CheckResult } from './types'

import { createDiagnosticError } from '@mokup/shared/diagnostics'
import { scanManifest } from './scan'

/**
 * Check mock routes without writing build artifacts or invoking request handlers.
 * Modules and directory configuration are loaded to resolve the route definitions.
 *
 * @param options - Scan options. All route diagnostics fail the check by default.
 * @returns A structured report. Input and module-loading errors reject the promise.
 *
 * @example
 * import { checkManifest } from '@mokup/cli'
 *
 * const result = await checkManifest({ dir: 'mock' })
 */
export async function checkManifest(options: CheckOptions = {}): Promise<CheckResult> {
  const { manifest, diagnosticSections } = await scanManifest({ ...options, handlers: true }, true)
  const diagnostics: CheckDiagnostic[] = diagnosticSections
    .map((section) => {
      const items = Array.from(new Set(section.items)).sort()
      return { ...section, items, count: items.length }
    })
    .filter(section => section.count > 0)
  const error = createDiagnosticError({
    sections: diagnostics,
    errorOn: options.errorOn ?? 'all',
  })

  return {
    schemaVersion: 1,
    valid: error === null,
    routeCount: manifest.routes.length,
    diagnostics,
  }
}
