import type { createRuntime, Manifest, ModuleMap, RuntimeOptions } from '@mokup/runtime'
import type { HttpRequestContext } from '@mokup/runtime/http'

/**
 * Options for server adapters built on top of the runtime.
 *
 * @example
 * import type { ServerOptions } from '@mokup/server'
 *
 * const options: ServerOptions = {
 *   manifest: { version: 1, routes: [] },
 *   onNotFound: 'next',
 * }
 */
export interface ServerOptions extends RuntimeOptions {
  /**
   * Behavior when no route matches.
   *
   * @default "next"
   */
  onNotFound?: 'next' | 'response'
}

/**
 * Fetch handler signature used by server adapters.
 *
 * @example
 * import type { FetchHandler } from '@mokup/server'
 *
 * const handler: FetchHandler = async (request) => new Response('ok')
 */
export type FetchHandler = (request: Request, context?: HttpRequestContext) => Promise<Response | null>

/** Controls share the exact runtime that dispatches this adapter's requests. */
export type RuntimeControls = Pick<ReturnType<typeof createRuntime>, 'signal' | 'ready' | 'use' | 'resetHandlers' | 'restoreHandlers' | 'listHandlers' | 'setOnUnhandled' | 'scenario' | 'selectScenario' | 'resetScenario' | 'events' | 'close'>

export type ControlledFetchHandler = FetchHandler & RuntimeControls

/**
 * Bundle input for Worker helpers.
 *
 * @example
 * import type { WorkerBundle } from '@mokup/server'
 *
 * const bundle: WorkerBundle = {
 *   manifest: { version: 1, routes: [] },
 * }
 */
export interface WorkerBundle extends Pick<RuntimeOptions, 'handlers' | 'onUnhandled' | 'scenario'> {
  /** Manifest for runtime execution. */
  manifest: Manifest
  /**
   * In-memory module map for handler execution.
   *
   * @default undefined
   */
  moduleMap?: ModuleMap | undefined
  /**
   * Base directory for module resolution.
   *
   * @default undefined
   */
  moduleBase?: string | URL | undefined
  /**
   * Behavior when no route matches.
   *
   * @default "response"
   */
  onNotFound?: 'next' | 'response'
}

/**
 * Worker input accepted by createMokupWorker.
 *
 * @example
 * import type { WorkerInput } from '@mokup/server'
 *
 * const input: WorkerInput = { version: 1, routes: [] }
 */
export type WorkerInput = Manifest | WorkerBundle
