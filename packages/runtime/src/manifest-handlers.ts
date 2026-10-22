import type { HttpHandler } from './http/types'
import type { RuntimeOptions } from './types'
import { compileResolvedRouteHandlers } from './resolved-handlers'
import { createManifestRoutes } from './runtime/handlers'

/** Compile lazy file modules into the same session-owned definitions as scanned routes. */
export async function compileManifestHandlers(options: RuntimeOptions): Promise<HttpHandler[]> {
  return compileResolvedRouteHandlers(await createManifestRoutes({
    manifest: options.manifest,
    moduleCache: new Map(),
    middlewareCache: new Map(),
    ...(options.moduleBase !== undefined ? { moduleBase: options.moduleBase } : {}),
    ...(options.moduleMap !== undefined ? { moduleMap: options.moduleMap } : {}),
  }))
}
