import type { createRuntime, RuntimeResult } from '@mokup/runtime'
import type { NodeRequestLike } from './types'
import { withStreamLifecycle } from '@mokup/shared/stream-body'
import { prepareFetchRequest, prepareNodeRequest } from './request'

type Runtime = Pick<ReturnType<typeof createRuntime>, 'hasRoute' | 'handle'>
type PreparedRequest = ReturnType<typeof prepareFetchRequest>

async function handlePreparedRequest(runtime: Runtime, prepared: PreparedRequest, stream?: NodeRequestLike): Promise<RuntimeResult | null> {
  const routeRequest = { method: prepared.request.method, path: prepared.request.path }
  const matched = stream
    ? await withStreamLifecycle(stream, () => runtime.hasRoute(routeRequest))
    : await runtime.hasRoute(routeRequest)
  if (!matched) {
    return null
  }
  return runtime.handle(await prepared.readBody())
}

/** Only consume a Node request after the runtime accepts its route. */
export async function handleNodeRequest(runtime: Runtime, request: NodeRequestLike, bodyOverride?: unknown): Promise<RuntimeResult | null> {
  return handlePreparedRequest(runtime, prepareNodeRequest(request, bodyOverride), request)
}

/** Leave an unmatched Fetch request's body available for the next handler. */
export async function handleFetchRequest(runtime: Runtime, request: Request): Promise<RuntimeResult | null> {
  return handlePreparedRequest(runtime, prepareFetchRequest(request))
}
