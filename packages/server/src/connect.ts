import type { NodeRequestLike, NodeResponseLike } from './internal'
import type { ServerOptions } from './types'
import { IncomingMessage, ServerResponse } from 'node:http'
import { createRuntime } from '@mokup/runtime'
import {
  applyRuntimeResultToNode,
  toRuntimeOptions,
} from './internal'
import { withRuntimeControls } from './internal/controls'
import { handleNodeRequest } from './internal/handle-request'
import { dispatchNodeSession } from './internal/node-session'

type NextFunction = (error?: unknown) => void

/**
 * Create a Connect-style middleware from server options.
 *
 * @param options - Server options.
 * @returns Connect middleware handler.
 *
 * @example
 * import { createConnectMiddleware } from '@mokup/server'
 *
 * const middleware = createConnectMiddleware({ manifest: { version: 1, routes: [] } })
 */
export function createConnectMiddleware(
  options: ServerOptions,
) {
  const runtime = createRuntime(toRuntimeOptions(options))
  const onNotFound = options.onNotFound ?? 'next'

  const middleware = async (
    req: NodeRequestLike,
    res: NodeResponseLike,
    next: NextFunction,
  ) => {
    try {
      if (req instanceof IncomingMessage && res instanceof ServerResponse) {
        if (await dispatchNodeSession(runtime, req, res)) {
          return
        }
      }
      else {
        const result = await handleNodeRequest(runtime, req)
        if (result) {
          applyRuntimeResultToNode(res, result)
          return
        }
      }
      if (onNotFound === 'response') {
        res.statusCode = 404
        res.end()
        return
      }
    }
    catch (error) {
      next(error)
      return
    }
    next()
  }
  return withRuntimeControls(middleware, runtime)
}
