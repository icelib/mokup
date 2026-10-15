import type { DiagnosticCategory, DiagnosticErrorMode } from '@mokup/shared'
import type { MiddlewareHandler } from '@mokup/shared/hono'

export type { DiagnosticCategory, DiagnosticErrorMode } from '@mokup/shared'
export type { MiddlewareHandler } from '@mokup/shared/hono'

/**
 * Options for building a mokup manifest.
 *
 * @example
 * import type { BuildOptions } from '@mokup/cli'
 *
 * const options: BuildOptions = {
 *   dir: 'mock',
 *   outDir: '.mokup',
 * }
 */
export interface BuildOptions {
  /**
   * Directory or directories to scan for mock files.
   *
   * @default "mock"
   */
  dir?: string | string[]
  /**
   * Output directory for manifest artifacts.
   *
   * @default ".mokup"
   */
  outDir?: string
  /**
   * URL prefix to apply to generated routes.
   *
   * @default ""
   */
  prefix?: string
  /**
   * Include filter for files.
   *
   * @default undefined
   */
  include?: RegExp | RegExp[]
  /**
   * Exclude filter for files.
   *
   * @default undefined
   */
  exclude?: RegExp | RegExp[]
  /**
   * Ignore file or folder prefixes.
   *
   * @default ["."]
   */
  ignorePrefix?: string | string[]
  /**
   * Emit handler bundles for module-based responses.
   *
   * @default true
   */
  handlers?: boolean
  /**
   * Project root used to resolve paths.
   *
   * @default process.cwd()
   */
  root?: string
  /**
   * Optional logger for build messages.
   *
   * @default undefined
   */
  log?: (message: string) => void
  /**
   * Promote selected diagnostics from warnings to errors.
   *
   * @default undefined
   */
  errorOn?: DiagnosticErrorMode
}

/** Options for checking mock routes without creating build artifacts. */
export type CheckOptions = Pick<
  BuildOptions,
  'dir' | 'root' | 'prefix' | 'include' | 'exclude' | 'ignorePrefix' | 'errorOn'
>

/** A nonempty group of route diagnostics in a check report. */
export interface CheckDiagnostic {
  category: DiagnosticCategory
  label: string
  count: number
  items: string[]
  advice?: string
}

/** Stable, serializable route-check output. */
export interface CheckResult {
  schemaVersion: 1
  valid: boolean
  routeCount: number
  diagnostics: CheckDiagnostic[]
  /** CLI error details when scanning could not complete. The API rejects instead. */
  error?: { message: string }
}

/**
 * Route rule shape used in build-time resolution.
 *
 * @example
 * import type { RouteRule } from '@mokup/cli'
 *
 * const rule: RouteRule = { handler: { ok: true } }
 */
export interface RouteRule {
  /** Route handler or static value. */
  handler: unknown
  /**
   * Enable or disable this rule.
   *
   * @default true
   */
  enabled?: boolean
  /**
   * Override response status code.
   *
   * @default 200
   */
  status?: number
  /**
   * Additional response headers.
   *
   * @default {}
   */
  headers?: Record<string, string>
  /**
   * Delay in milliseconds before responding.
   *
   * @default 0
   */
  delay?: number
}

/**
 * Directory-level config used during manifest build.
 *
 * @example
 * import type { RouteDirectoryConfig } from '@mokup/cli'
 *
 * const config: RouteDirectoryConfig = {
 *   headers: { 'x-mokup': 'dir' },
 * }
 */
export interface RouteDirectoryConfig {
  /**
   * Headers applied to routes in this directory.
   *
   * @default {}
   */
  headers?: Record<string, string>
  /**
   * Default status code override.
   *
   * @default 200
   */
  status?: number
  /**
   * Default delay in milliseconds.
   *
   * @default 0
   */
  delay?: number
  /**
   * Enable or disable this directory.
   *
   * @default true
   */
  enabled?: boolean
  /**
   * Ignore prefixes applied to files in this directory.
   *
   * @default ["."]
   */
  ignorePrefix?: string | string[]
  /**
   * Include filter for files.
   *
   * @default undefined
   */
  include?: RegExp | RegExp[]
  /**
   * Exclude filter for files.
   *
   * @default undefined
   */
  exclude?: RegExp | RegExp[]
  /**
   * Middleware for the directory.
   *
   * @default undefined
   */
  middleware?: MiddlewareHandler | MiddlewareHandler[]
  /**
   * Error handling policy for defineConfig hooks.
   *
   * @default "warn"
   */
  hookError?: HookErrorPolicy
}

/**
 * Middleware execution position.
 *
 * @example
 * import type { MiddlewarePosition } from '@mokup/cli'
 *
 * const position: MiddlewarePosition = 'pre'
 */
export type MiddlewarePosition = 'pre' | 'normal' | 'post'

/**
 * Error handling policy for config hooks.
 */
export type HookErrorPolicy = 'throw' | 'warn' | 'silent'

/**
 * Middleware registry used by defineConfig.
 *
 * @example
 * import type { MiddlewareRegistry } from '@mokup/cli'
 *
 * const registry: MiddlewareRegistry = { use: () => {} }
 */
export interface MiddlewareRegistry {
  use: (...handlers: MiddlewareHandler[]) => void
}

/**
 * File entry discovered during a build scan.
 *
 * @example
 * import type { FileInfo } from '@mokup/cli'
 *
 * const info: FileInfo = { file: 'mock/ping.get.ts', rootDir: 'mock' }
 */
export type FileInfo = import('@mokup/shared/mock-files').FileInfo
