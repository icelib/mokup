import type { Configuration } from 'webpack'
import type { MokupPluginOptions } from './shared/types.js'
import { createMokupWebpackPlugin } from './webpack/plugin.js'

export type {
  Context,
  DiagnosticCategory,
  DiagnosticErrorMode,
  HttpMethod,
  MiddlewareHandler,
  MiddlewarePosition,
  MiddlewareRegistry,
  MokupPluginOptions,
  PlaygroundOptionsInput,
  RequestHandler,
  RouteDirectoryConfig,
  RouteResponse,
  RouteRule,
  RuntimeMode,
  ServiceWorkerOptions,
  VitePluginOptions,
  VitePluginOptionsInput,
} from './shared/types.js'

export type { MokupWebpackPlugin } from './webpack/plugin.js'

/**
 * Webpack plugin options (alias of MokupPluginOptions).
 *
 * @example
 * import type { WebpackPluginOptions } from 'mokup/webpack'
 *
 * const options: WebpackPluginOptions = { entries: { dir: 'mock' } }
 */
export type WebpackPluginOptions = MokupPluginOptions

/**
 * Webpack plugin options input (alias of MokupPluginOptions).
 *
 * @example
 * import type { WebpackPluginOptionsInput } from 'mokup/webpack'
 *
 * const options: WebpackPluginOptionsInput = { entries: { dir: 'mock' } }
 */
export type WebpackPluginOptionsInput = MokupPluginOptions

/**
 * Create the mokup webpack plugin.
 *
 * @example
 * import { createWebpackPlugin } from 'mokup/webpack'
 */
export { createMokupWebpackPlugin, createMokupWebpackPlugin as createWebpackPlugin }

export type WebpackConfig = Configuration & {
  devServer?: Record<string, unknown>
}

type WebpackConfigFactory = (...args: unknown[]) => WebpackConfig | WebpackConfig[] | Promise<WebpackConfig | WebpackConfig[]>

export type WebpackConfigInput = WebpackConfig | WebpackConfig[] | WebpackConfigFactory

type WithMokup<T>
  = T extends (...args: infer A) => infer R
    ? (...args: A) => Promise<WithMokup<Awaited<R>>>
    : T extends Array<infer U>
      ? Array<WithMokup<U>>
      : T extends WebpackConfig
        ? T
        : WebpackConfig

/**
 * Create a webpack config wrapper for Mokup.
 *
 * @example
 * import { mokupWebpack } from 'mokup/webpack'
 *
 * const withMokup = mokupWebpack({ entries: { dir: 'mock' } })
 *
 * export default withMokup({
 *   devServer: {},
 * })
 */
export function mokupWebpack(options: WebpackPluginOptionsInput = {}) {
  const plugin = createMokupWebpackPlugin(options)

  const applyConfig = <T extends WebpackConfig>(config: T = {} as T): T => {
    const plugins = Array.isArray(config.plugins) ? config.plugins : []
    const devServer = config.devServer && typeof config.devServer === 'object'
      ? { ...config.devServer }
      : {}
    return {
      ...config,
      plugins: [...plugins, plugin],
      devServer,
    } as T
  }

  const applyInput = <T extends WebpackConfigInput>(input: T): WithMokup<T> => {
    if (typeof input === 'function') {
      const wrapped = async (...args: unknown[]) => {
        const resolved = await input(...args)
        if (Array.isArray(resolved)) {
          return resolved.map(item => applyConfig(item))
        }
        return applyConfig(resolved ?? {})
      }
      return wrapped as WithMokup<T>
    }
    if (Array.isArray(input)) {
      return input.map(item => applyConfig(item)) as WithMokup<T>
    }
    return applyConfig((input ?? {}) as WebpackConfig) as WithMokup<T>
  }

  return applyInput
}
