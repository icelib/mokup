import type { ResolvedSwConfig } from '@mokup/core'
import type { IndexHtmlTransformResult, PreviewServer, ViteDevServer } from 'vite'
import { buildSwLifecycleScript } from './sw'

async function transformMokupIndexHtml(
  html: string,
  params: {
    state: { swRoutes: unknown[] }
    refreshRoutes: (server?: ViteDevServer | PreviewServer) => Promise<void>
    currentServer: ViteDevServer | PreviewServer | null
    command: 'serve' | 'build'
    base: string
    swConfig: ResolvedSwConfig | null
    unregisterConfig: ResolvedSwConfig
    hasSwEntries: boolean
    resolveSwImportPath: (base: string) => string
    resolveRequestPath: (path: string) => string
    resolveRegisterScope: (scope: string) => string
    swLifecycleFileName: string | null
    swLifecycleImportPath: string
    resolveHtmlAssetPath: (path: string) => string
  },
): Promise<string | IndexHtmlTransformResult> {
  if (params.state.swRoutes.length === 0) {
    await params.refreshRoutes(params.currentServer ?? undefined)
  }
  const script = buildSwLifecycleScript({
    importPath: params.command === 'build' ? 'mokup/sw' : params.resolveSwImportPath(params.base),
    swConfig: params.swConfig,
    unregisterConfig: params.unregisterConfig,
    hasSwEntries: params.hasSwEntries,
    hasSwRoutes: !!params.swConfig && params.state.swRoutes.length > 0,
    resolveRequestPath: params.resolveRequestPath,
    resolveRegisterScope: params.resolveRegisterScope,
  })
  if (!script) {
    return html
  }
  if (params.command === 'build') {
    if (!params.swLifecycleFileName) {
      return html
    }
    const src = params.resolveHtmlAssetPath(params.swLifecycleFileName)
    return {
      html,
      tags: [
        {
          tag: 'script',
          attrs: { type: 'module', src },
          injectTo: 'head' as const,
        },
      ],
    }
  }
  return {
    html,
    tags: [
      {
        tag: 'script',
        attrs: { type: 'module', src: params.swLifecycleImportPath },
        injectTo: 'head' as const,
      },
    ],
  }
}

export { transformMokupIndexHtml }
