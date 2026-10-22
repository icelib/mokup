import type { HttpHandler, HttpScenario, UnhandledRequestPolicy } from '@mokup/runtime/http'
import type { MockEntryOptions, PlaygroundOptionsInput } from '@mokup/shared'
import type { DiagnosticErrorMode } from './dev/types'

/**
 * Options for a fetch-based mokup server.
 *
 * @example
 * import type { FetchServerOptions } from '@mokup/server'
 *
 * const options: FetchServerOptions = { dir: 'mock', prefix: '/api' }
 */
export interface FetchServerOptions extends MockEntryOptions {
  /**
   * Hostname to bind when used by a CLI or adapter.
   *
   * @default undefined
   */
  host?: string
  /**
   * Port to bind when used by a CLI or adapter.
   *
   * @default undefined
   */
  port?: number
  /**
   * Root directory used to resolve paths.
   *
   * @default process.cwd()
   */
  root?: string
  /**
   * Promote selected diagnostics from warnings to errors.
   *
   * @default undefined
   */
  errorOn?: DiagnosticErrorMode
}

/**
 * Top-level fetch server configuration.
 *
 * @example
 * import type { FetchServerOptionsConfig } from '@mokup/server'
 *
 * const config: FetchServerOptionsConfig = {
 *   entries: { dir: 'mock' },
 *   playground: true,
 * }
 */
export interface FetchServerOptionsConfig {
  /** Standard handlers take priority over file-derived initial rules. */
  handlers?: readonly HttpHandler[]
  onUnhandled?: UnhandledRequestPolicy
  /** Named scenario catalog shared with the standalone server and Playground. */
  scenario?: HttpScenario
  /**
   * Entry or entries to scan.
   *
   * @default [{ }]
   */
  entries?: FetchServerOptions | FetchServerOptions[]
  /**
   * Playground configuration.
   *
   * @default { enabled: true, path: "/__mokup" }
   */
  playground?: PlaygroundOptionsInput
}

/**
 * Alias for fetch server options input.
 *
 * @example
 * import type { FetchServerOptionsInput } from '@mokup/server'
 */
export type FetchServerOptionsInput = FetchServerOptionsConfig
