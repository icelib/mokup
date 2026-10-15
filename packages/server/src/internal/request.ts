import type { RuntimeRequest } from '@mokup/runtime'
import type { ResolvedRequestBody } from './body'
import type { NodeRequestLike } from './types'
import { resolveBody } from './body'
import { normalizeHeaders, normalizeNodeHeaders, normalizeQuery } from './normalize'
import { resolveNodeRequestUrl } from './request-url'

interface PreparedRequest {
  request: RuntimeRequest
  readBody: () => Promise<RuntimeRequest>
}

function prepareRequest(
  url: URL,
  method: string,
  headers: Record<string, string>,
  readBody: () => Promise<ResolvedRequestBody>,
): PreparedRequest {
  const request: RuntimeRequest = {
    method,
    path: url.pathname,
    query: normalizeQuery(url.searchParams),
    headers,
    body: undefined,
  }
  return {
    request,
    async readBody() {
      const { body, rawBody, rawBodyBytes } = await readBody()
      return { ...request, body, ...(rawBody ? { rawBody } : {}), ...(rawBodyBytes ? { rawBodyBytes } : {}) }
    },
  }
}

/** Prepare routing metadata without reading, locking, or cloning the body. */
export function prepareFetchRequest(request: Request): PreparedRequest {
  const url = new URL(request.url)
  const headers = normalizeHeaders(request.headers)
  const contentType = (headers['content-type'] ?? '').split(';')[0]?.trim() ?? ''
  return prepareRequest(url, request.method, headers, async () => {
    const hasBody = request.body !== null
    const bytes = await request.arrayBuffer()
    return hasBody ? resolveBody(bytes, contentType) : { body: undefined }
  })
}

/** Validate Node routing metadata before attaching any body stream listeners. */
export function prepareNodeRequest(req: NodeRequestLike, bodyOverride?: unknown): PreparedRequest {
  const headers = normalizeNodeHeaders(req.headers)
  const contentType = (headers['content-type'] ?? '').split(';')[0]?.trim() ?? ''
  const url = resolveNodeRequestUrl(req.url ?? req.originalUrl ?? '/', headers)
  return prepareRequest(url, req.method ?? 'GET', headers, () => resolveBody(
    typeof bodyOverride === 'undefined' ? req.body : bodyOverride,
    contentType,
    req,
  ))
}

/**
 * Convert a Fetch Request into a RuntimeRequest.
 *
 * @param request - Fetch request.
 * @returns RuntimeRequest for the runtime engine.
 *
 * @example
 * import { toRuntimeRequestFromFetch } from '@mokup/server'
 *
 * const runtimeRequest = await toRuntimeRequestFromFetch(new Request('http://localhost/api'))
 */
export async function toRuntimeRequestFromFetch(
  request: Request,
): Promise<RuntimeRequest> {
  return prepareFetchRequest(request).readBody()
}

/**
 * Convert a Node-style request into a RuntimeRequest.
 *
 * @param req - Node request-like object.
 * @param bodyOverride - Optional body override.
 * @returns RuntimeRequest for the runtime engine.
 *
 * @example
 * import { toRuntimeRequestFromNode } from '@mokup/server'
 *
 * const runtimeRequest = await toRuntimeRequestFromNode({ url: '/api', on: () => {} })
 */
export async function toRuntimeRequestFromNode(
  req: NodeRequestLike,
  bodyOverride?: unknown,
): Promise<RuntimeRequest> {
  return prepareNodeRequest(req, bodyOverride).readBody()
}
