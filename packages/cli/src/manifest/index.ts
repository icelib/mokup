import type { BuildOptions } from './types'

import { promises as fs } from 'node:fs'

import { reportDiagnostics } from '@mokup/shared/diagnostics'
import { join } from '@mokup/shared/pathe'
import { writeBundle, writeManifestModule } from './bundle'
import { bundleHandlers, writeHandlerIndex } from './handlers'
import { scanManifest } from './scan'

export { checkManifest } from './check'

/**
 * Build and write a mokup manifest to disk.
 *
 * @param options - Build options.
 * @returns Build output metadata.
 *
 * @example
 * import { buildManifest } from '@mokup/cli'
 *
 * const result = await buildManifest({ dir: 'mock', outDir: '.mokup' })
 */
export async function buildManifest(options: BuildOptions = {}) {
  const {
    root,
    outDir,
    handlersDir,
    manifest,
    handlerSources,
    handlerModuleMap,
    diagnosticSections,
  } = await scanManifest(options)

  await fs.mkdir(outDir, { recursive: true })
  if (handlerSources.size > 0) {
    await fs.mkdir(handlersDir, { recursive: true })
    await bundleHandlers(Array.from(handlerSources), root, handlersDir)
    await writeHandlerIndex(handlerModuleMap, handlersDir, outDir)
  }
  const manifestPath = join(outDir, 'mokup.manifest.json')
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  await writeManifestModule(outDir, manifest)
  await writeBundle(outDir, handlerSources.size > 0)

  const diagnosticParams: Parameters<typeof reportDiagnostics>[0] = {
    sections: diagnosticSections,
    warn: message => options.log?.(message),
  }
  if (typeof options.errorOn !== 'undefined') {
    diagnosticParams.errorOn = options.errorOn
  }
  const { error: diagnosticError } = reportDiagnostics(diagnosticParams)
  if (diagnosticError) {
    throw diagnosticError
  }

  options.log?.(`Manifest written to ${manifestPath}`)

  return {
    manifest,
    manifestPath,
  }
}
