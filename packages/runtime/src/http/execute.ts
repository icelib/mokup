import type { createResolverRunner } from './resolver'
import type { HttpHandler, HttpResolverContext, HttpResolverResult } from './types'
import { isResponse } from './is-response'
import { withAbort } from './resources'

/** Middleware may outlive an aborted request; dispose a response it returns later. */
export async function executeHandler(handler: HttpHandler, runner: ReturnType<typeof createResolverRunner>, context: HttpResolverContext, signal: AbortSignal): Promise<HttpResolverResult> {
  let resolution: Promise<HttpResolverResult> | undefined
  const resolve = (input = context) => {
    resolution ??= runner.resolve(handler.resolver, input, signal)
    return resolution
  }
  const task = Promise.resolve(handler.execute ? handler.execute(context, resolve) : resolve())
  void task.then(async (result) => {
    if (signal.aborted && isResponse(result)) {
      await result.body?.cancel(signal.reason)
    }
  }).catch(() => undefined)
  return await withAbort(task, signal)
}
