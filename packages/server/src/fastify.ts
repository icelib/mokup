import type { NodeRequestLike } from './internal'
import type { ServerOptions } from './types'
import { IncomingMessage, ServerResponse } from 'node:http'
import { createRuntime } from '@mokup/runtime'
import fastifyPlugin from 'fastify-plugin'
import { toBinaryBody, toRuntimeOptions } from './internal'
import { withRuntimeControls } from './internal/controls'
import { handleNodeRequest } from './internal/handle-request'
import { dispatchNodeSession } from './internal/node-session'
import { resolveResponseHeaders } from './internal/response-headers'

type FastifyRequestLike = (NodeRequestLike & { raw?: NodeRequestLike }) | {
  raw: NodeRequestLike
  body?: unknown
}

interface FastifyReplyLike {
  raw?: ServerResponse
  hijack?: () => unknown
  status: (code: number) => FastifyReplyLike
  header: (name: string, value: string) => FastifyReplyLike
  send: (payload?: unknown) => void
}

interface FastifyInstanceLike {
  server?: unknown
  addHook: (
    name: 'onRequest',
    handler: (
      request: FastifyRequestLike,
      reply: FastifyReplyLike,
    ) => Promise<void> | void,
  ) => void
}

interface FastifyLifecycleInstance extends FastifyInstanceLike {
  addHook: FastifyInstanceLike['addHook'] & ((name: 'onClose', handler: () => Promise<void>) => void)
}

/** The native server distinguishes full Fastify hosts from minimal onRequest bridges. */
function hasCloseLifecycle(instance: FastifyInstanceLike): instance is FastifyLifecycleInstance {
  return instance.server !== undefined
}

/**
 * Create a Fastify plugin from server options.
 *
 * @param options - Server options.
 * @returns Fastify plugin handler.
 *
 * @example
 * import { createFastifyPlugin } from '@mokup/server'
 *
 * const plugin = createFastifyPlugin({ manifest: { version: 1, routes: [] } })
 */
export function createFastifyPlugin(
  options: ServerOptions,
) {
  const runtime = createRuntime(toRuntimeOptions(options))
  const onNotFound = options.onNotFound ?? 'next'

  const plugin = async (instance: FastifyInstanceLike) => {
    if (hasCloseLifecycle(instance)) {
      instance.addHook('onClose', async () => runtime.close())
    }
    instance.addHook('onRequest', async (request, reply) => {
      const rawRequest = (request.raw ?? request) as NodeRequestLike
      if (rawRequest instanceof IncomingMessage && reply.raw instanceof ServerResponse) {
        if (await dispatchNodeSession(runtime, rawRequest, reply.raw, request.body, () => {
          reply.hijack?.()
        })) {
          return
        }
        if (onNotFound === 'response') {
          reply.status(404).send()
        }
        return
      }
      const result = await handleNodeRequest(
        runtime,
        rawRequest,
        undefined,
        () => request.body,
      )
      if (!result) {
        if (onNotFound === 'response') {
          reply.status(404).send()
        }
        return
      }
      reply.status(result.status)
      const { headers, setCookies } = resolveResponseHeaders(result)
      for (const [key, value] of Object.entries(headers)) {
        reply.header(key, value)
      }
      for (const cookie of setCookies) {
        reply.header('set-cookie', cookie)
      }
      if (result.body === null) {
        reply.send()
        return
      }
      if (typeof result.body === 'string') {
        reply.send(result.body)
        return
      }
      reply.send(toBinaryBody(result.body))
    })
  }
  fastifyPlugin(plugin, { name: 'mokup' })
  return withRuntimeControls(plugin, runtime)
}
