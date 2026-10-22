import type { createRuntime, RuntimeResult } from '@mokup/runtime'
import type { NodeRequestLike } from './types'
import { IncomingMessage } from 'node:http'
import { toSessionRequest } from '@mokup/core/middleware'
import { toFetchRequest } from '@mokup/runtime'
import { withStreamLifecycle } from '@mokup/shared/stream-body'
import { prepareNodeRequest } from './request'

type Runtime = Pick<ReturnType<typeof createRuntime>, 'handle' | 'fetch'>

/** Structural hosts reuse parsed bodies; native HTTP streams retain replayable uploads. */
export async function handleNodeRequest(runtime: Runtime, request: NodeRequestLike, bodyOverride?: unknown, loadBodyOverride?: () => unknown): Promise<RuntimeResult | null> {
  // Validate before attaching lifecycle listeners or inspecting a body property.
  const prepared = prepareNodeRequest(request, bodyOverride)
  const controller = new AbortController()
  try {
    return await withStreamLifecycle(request, () => runtime.handle({ ...prepared.request, signal: controller.signal }, {
      async loadRequest(signal) {
        if (prepared.request.method === 'GET' || prepared.request.method === 'HEAD') {
          return toFetchRequest({ ...prepared.request, signal })
        }
        const override = loadBodyOverride ? loadBodyOverride() : bodyOverride
        if (request instanceof IncomingMessage) {
          return toSessionRequest(request, new URL(prepared.request.url!), signal, override === undefined ? (request as NodeRequestLike).body : override)
        }
        const input = await (loadBodyOverride ? prepareNodeRequest(request, override) : prepared).readBody(signal)
        // The minimal structural contract exposes a body rather than rewind methods.
        // Retain exact upload bytes for subsequent structural consumers.
        if (override === undefined && input.rawBodyBytes !== undefined) {
          request.body = input.rawBodyBytes
        }
        return toFetchRequest({ ...input, signal })
      },
    }))
  }
  catch (error) {
    controller.abort(error)
    throw error
  }
}

/** Leave an unmatched Fetch request's body available for the next handler. */
export async function handleFetchRequest(runtime: Pick<Runtime, 'fetch'>, request: Request): Promise<Response | null> {
  return runtime.fetch(request)
}
