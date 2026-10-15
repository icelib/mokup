import type { NodeRequestLike } from './internal'
import type { ServerOptions } from './types'

import { createRuntime } from '@mokup/runtime'
import fastifyPlugin from 'fastify-plugin'
import { toBinaryBody, toRuntimeOptions } from './internal'
import { handleNodeRequest } from './internal/handle-request'
import { resolveResponseHeaders } from './internal/response-headers'

type FastifyRequestLike = (NodeRequestLike & { raw?: NodeRequestLike }) | {
  raw: NodeRequestLike
  body?: unknown
}

interface FastifyReplyLike {
  status: (code: number) => FastifyReplyLike
  header: (name: string, value: string) => FastifyReplyLike
  send: (payload?: unknown) => void
}

interface FastifyInstanceLike {
  addHook: (
    name: 'onRequest',
    handler: (
      request: FastifyRequestLike,
      reply: FastifyReplyLike,
    ) => Promise<void> | void,
  ) => void
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
    instance.addHook('onRequest', async (request, reply) => {
      const rawRequest = (request.raw ?? request) as NodeRequestLike
      const result = await handleNodeRequest(
        runtime,
        rawRequest,
        request.body,
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
  return plugin
}
