import type { RuntimeOptions, RuntimeResult } from '@mokup/runtime'
import type { ServerOptions } from '../types'
import type { NodeResponseLike } from './types'
import { toBinaryBody } from './body'
import { resolveResponseHeaders } from './response-headers'

/**
 * Convert server adapter options to runtime options.
 *
 * @param options - Server options.
 * @returns Runtime options.
 *
 * @example
 * import { toRuntimeOptions } from '@mokup/server'
 *
 * const runtime = toRuntimeOptions({ manifest: { version: 1, routes: [] } })
 */
export function toRuntimeOptions(
  options: ServerOptions,
): RuntimeOptions {
  const runtimeOptions: RuntimeOptions = {
    manifest: options.manifest,
  }
  if (typeof options.moduleBase !== 'undefined') {
    runtimeOptions.moduleBase = options.moduleBase
  }
  if (typeof options.moduleMap !== 'undefined') {
    runtimeOptions.moduleMap = options.moduleMap
  }
  return runtimeOptions
}

/**
 * Apply a RuntimeResult to a Node response-like object.
 *
 * @param res - Node response-like object.
 * @param result - Runtime result to apply.
 *
 * @example
 * import { applyRuntimeResultToNode } from '@mokup/server'
 *
 * applyRuntimeResultToNode({ setHeader: () => {}, end: () => {} }, {
 *   status: 200,
 *   headers: {},
 *   body: 'ok',
 * })
 */
export function applyRuntimeResultToNode(
  res: NodeResponseLike,
  result: RuntimeResult,
) {
  res.statusCode = result.status
  const { headers, setCookies } = res.appendHeader
    ? resolveResponseHeaders(result)
    : { headers: result.headers, setCookies: [] }
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value)
  }
  const [firstCookie, ...additionalCookies] = setCookies
  if (firstCookie !== undefined) {
    res.setHeader('set-cookie', firstCookie)
    for (const cookie of additionalCookies) {
      res.appendHeader?.('set-cookie', cookie)
    }
  }
  if (result.body === null) {
    res.end()
    return
  }
  if (typeof result.body === 'string') {
    res.end(result.body)
    return
  }
  res.end(toBinaryBody(result.body))
}
