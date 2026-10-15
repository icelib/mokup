import type { Logger } from '../../shared/types'
import type { WebpackBuildSession } from './session'
import type { WebpackCompilation, WebpackCompiler } from './types'
import { resolveHtmlWebpackPlugin } from './html'
import { joinPublicPath } from './paths'

export function createCompilationHandler(params: {
  compiler: WebpackCompiler
  getSession: () => WebpackBuildSession | null
  lifecycleFileName: string
  swPath: string | undefined
  logger: Logger
}) {
  const pluginName = 'mokup:webpack'
  let warnedHtml = false
  return (compilation: WebpackCompilation) => {
    const session = params.getSession()
    const snapshot = session?.peek()
    const isCurrent = () => !!session?.isActive() && params.getSession() === session
    const HtmlWebpackPlugin = resolveHtmlWebpackPlugin()
    if (HtmlWebpackPlugin) {
      const hooks = HtmlWebpackPlugin.getHooks(compilation)
      if (snapshot?.bundles.swLifecycleBundle) {
        const tag = (publicPath: string | undefined) => ({
          tagName: 'script',
          voidTag: false,
          attributes: { type: 'module', src: joinPublicPath(publicPath ?? '', params.lifecycleFileName) },
          meta: { plugin: pluginName },
        })
        if ('alterAssetTagGroups' in hooks && hooks.alterAssetTagGroups) {
          hooks.alterAssetTagGroups.tap(pluginName, (data) => {
            if (isCurrent()) {
              data.headTags.unshift(tag(data.publicPath))
            }
          })
        }
        else if ('alterAssetTags' in hooks && hooks.alterAssetTags) {
          hooks.alterAssetTags.tap(pluginName, (data) => {
            if (isCurrent()) {
              data.assetTags.scripts.unshift(tag(data.publicPath))
            }
          })
        }
      }
    }
    else if (!warnedHtml) {
      warnedHtml = true
      params.logger.warn('html-webpack-plugin not found; skip SW lifecycle injection.')
    }

    compilation.hooks.processAssets.tapPromise(
      { name: pluginName, stage: params.compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS },
      async () => {
        if (!snapshot || !isCurrent()) {
          return
        }
        const emit = (name: string, code: string) => {
          const source = new params.compiler.webpack.sources.RawSource(code)
          if (compilation.getAsset(name)) {
            compilation.updateAsset(name, source)
          }
          else {
            compilation.emitAsset(name, source)
          }
        }
        if (snapshot.bundles.swLifecycleBundle) {
          emit(params.lifecycleFileName, snapshot.bundles.swLifecycleBundle)
        }
        if (snapshot.bundles.swBundle && params.swPath) {
          emit(params.swPath.startsWith('/') ? params.swPath.slice(1) : params.swPath, snapshot.bundles.swBundle)
        }
      },
    )
  }
}
