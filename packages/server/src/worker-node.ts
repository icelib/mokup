import type { ModuleMap } from '@mokup/runtime'

import type { WorkerBundle, WorkerInput } from './types'
import type { ControlledFetchWorker } from './worker'

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMokupWorker as createWebWorker } from './worker'

/**
 * Minimal Worker-style fetch interface for Node helpers.
 *
 * @example
 * import type { FetchWorker } from '@mokup/server/node'
 *
 * const worker: FetchWorker = { fetch: async () => new Response('ok') }
 */
export type { ControlledFetchWorker, FetchWorker } from './worker'

/**
 * Input accepted by the Node worker helper.
 *
 * @example
 * import type { NodeWorkerInput } from '@mokup/server/node'
 *
 * const input: NodeWorkerInput = '.mokup'
 */
export type NodeWorkerInput = string | WorkerInput

function ensureTrailingSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`
}

export function resolveModuleBase(dir: string) {
  const absolute = resolve(dir)
  return ensureTrailingSlash(pathToFileURL(absolute).href)
}

async function loadBundleFromDir(dir: string): Promise<WorkerBundle> {
  const nodeProcess = await import('node:process')
  const isNode = typeof nodeProcess !== 'undefined' && !!nodeProcess.versions?.node
  if (!isNode) {
    throw new TypeError('createMokupWorker(dir) is only supported in Node runtimes.')
  }

  const { readFile, access } = await import('node:fs/promises')

  const manifestPath = resolve(dir, 'mokup.manifest.json')
  const manifestRaw = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(manifestRaw) as WorkerBundle['manifest']

  const handlersIndexPath = resolve(dir, 'mokup-handlers', 'index.mjs')
  let moduleMap: ModuleMap | undefined
  try {
    await access(handlersIndexPath)
    const module = await import(pathToFileURL(handlersIndexPath).href)
    moduleMap = (module as { mokupModuleMap?: ModuleMap }).mokupModuleMap
  }
  catch {
    moduleMap = undefined
  }

  const bundle: WorkerBundle = {
    manifest,
    moduleBase: resolveModuleBase(dir),
  }
  if (typeof moduleMap !== 'undefined') {
    bundle.moduleMap = moduleMap
  }
  return bundle
}

/**
 * Create a Worker-compatible fetch handler for Node.
 *
 * @param input - Directory path, manifest, or bundle.
 * @returns Worker handler or a promise when input is a directory.
 *
 * @example
 * import { createMokupWorker } from '@mokup/server/node'
 *
 * const worker = await createMokupWorker('.mokup')
 */
export function createMokupWorker(input: string): Promise<ControlledFetchWorker>
export function createMokupWorker(input: WorkerInput): ControlledFetchWorker
export function createMokupWorker(
  input: NodeWorkerInput,
): ControlledFetchWorker | Promise<ControlledFetchWorker> {
  if (typeof input === 'string') {
    return loadBundleFromDir(input)
      .then(bundle => createWebWorker(bundle))
  }
  return createWebWorker(input)
}
