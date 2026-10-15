/**
 * Build a mokup manifest from a mock directory.
 *
 * @example
 * import { buildManifest } from '@mokup/cli'
 *
 * await buildManifest({ dir: 'mock', outDir: '.mokup' })
 */
export { buildManifest, checkManifest } from './manifest'
/**
 * Directory config helper for manifest builds.
 *
 * @example
 * import { defineConfig } from '@mokup/cli'
 */
export { defineConfig, onAfterAll, onBeforeAll } from './manifest/define-config'
/**
 * Build options for the manifest CLI.
 *
 * @example
 * import type { BuildOptions } from '@mokup/cli'
 */
export type {
  BuildOptions,
  CheckDiagnostic,
  CheckOptions,
  CheckResult,
  DiagnosticCategory,
  DiagnosticErrorMode,
  HookErrorPolicy,
  MiddlewarePosition,
  MiddlewareRegistry,
  RouteDirectoryConfig,
  RouteRule,
} from './manifest/types'
/**
 * Create and run the mokup CLI program.
 *
 * @example
 * import { runCli } from '@mokup/cli'
 *
 * await runCli(['node', 'mokup', 'build', '--dir', 'mock'])
 */
export { createCli, runCli } from './program'
