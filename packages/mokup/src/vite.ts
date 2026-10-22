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
  RuntimeTarget,
  ServiceWorkerOptions,
  VitePluginOptions,
  VitePluginOptionsInput,
} from './shared/types.js'

/**
 * Vite plugin entry for mokup.
 *
 * @example
 * import mokup from 'mokup/vite'
 *
 * export default {
 *   plugins: [mokup({ entries: { dir: 'mock' } })],
 * }
 */
export { createMokupPlugin as default } from './vite/plugin.js'
export type { MokupVitePlugin } from './vite/plugin.js'
