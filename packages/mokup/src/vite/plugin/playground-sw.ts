import type { PreviewServer, ViteDevServer } from 'vite'
import { statSync } from 'node:fs'
import { isInDirs, normalizePathForComparison } from '@mokup/shared/path-utils'
import { resolve } from '@mokup/shared/pathe'
import { normalizeBase, resolveSwImportPath } from './paths'
import { isViteDevServer } from './server'
import { buildSwLifecycleInlineScript, buildSwLifecycleScript } from './sw'

function hasPreviewWorker(outDir: string, base: string, requestPath: string) {
  const origin = 'http://mokup.local'
  let url: URL
  try {
    url = new URL(requestPath, origin)
  }
  catch {
    return false
  }
  const basePath = normalizeBase(base)
  if (url.origin !== origin || !url.pathname.startsWith(basePath)) {
    return false
  }
  let pathname = `/${url.pathname.slice(basePath.length)}`
  // Vite strips its public base, then sirv decodes the remaining URL with
  // decodeURI. Reserved separators such as %2F must remain literal filenames.
  try {
    pathname = decodeURI(pathname)
  }
  catch {
    // sirv also retains the original pathname when decoding fails.
  }
  const outputRoot = resolve(outDir)
  const file = resolve(outputRoot, `.${pathname}`)
  if (normalizePathForComparison(file) === normalizePathForComparison(outputRoot)
    || !isInDirs(file, [outputRoot])) {
    return false
  }
  try {
    return statSync(file).isFile()
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return false
    }
    throw error
  }
}

export function buildPlaygroundSwLifecycleScript(params: Parameters<typeof buildSwLifecycleInlineScript>[0] & {
  server: ViteDevServer | PreviewServer | null
  outDir: string
  base: string
}) {
  if (!params.server) {
    return null
  }
  if (isViteDevServer(params.server)) {
    return buildSwLifecycleScript({ ...params, importPath: resolveSwImportPath(params.base) })
  }
  // Preview's worker is a build artifact, even when its source routes have
  // since changed. Current configuration still controls registration/removal.
  const hasWorker = !params.unregisterConfig.unregister
    && !!params.swConfig
    && params.swConfig.register !== false
    && hasPreviewWorker(params.outDir, params.base, params.resolveRequestPath(params.swConfig.path))
  return buildSwLifecycleInlineScript({ ...params, hasSwRoutes: hasWorker })
}
