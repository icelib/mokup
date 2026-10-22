import type { ResolvedRouteApp, ResolvedRouteAppOptions } from '@mokup/runtime'
import type { MockSession } from '@mokup/runtime/http'
import type { Hono } from '@mokup/shared/hono'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Logger, ResolvedRoute, RouteTable } from './shared/types'
import { createResolvedRouteApp, getRouteSession, takeRouteSessionMiss } from '@mokup/runtime'
import { isHeadFallbackHandler } from '@mokup/shared/head-routes'
import { readStreamBody } from '@mokup/shared/stream-body'
import { toSessionRequest } from './node-request'
import { sendNodeResponse } from './node-response'
import { parseRequestUrl, sendInvalidRequestUrl } from './shared/request-url'
import { normalizeMethod } from './shared/utils'

export { toSessionRequest } from './node-request'
export { sendNodeResponse } from './node-response'

/** Build file-route HTTP definitions with a Hono compatibility adapter. */
export function createHonoApp(routes: RouteTable, options: ResolvedRouteAppOptions<ResolvedRoute> = {}): ResolvedRouteApp {
  return createResolvedRouteApp(routes, options)
}

/** Minimal structural hosts cannot rewind a readable stream; retain their buffered bridge. */
async function toRequest(req: IncomingMessage, url: URL, signal: AbortSignal) {
  if (typeof req.read === 'function' && typeof req.unshift === 'function') {
    return toSessionRequest(req, url, signal)
  }
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(',') : value)
    }
  }
  const method = req.method ?? 'GET'
  const body = method === 'GET' || method === 'HEAD' ? null : await readStreamBody(req)
  return new Request(url, {
    method,
    headers,
    signal,
    ...(body && method !== 'GET' && method !== 'HEAD' ? { body: body as BodyInit } : {}),
  })
}

function hasMatch(app: Hono, method: string, pathname: string) {
  const methods = method === 'HEAD' ? ['HEAD', 'GET'] : [method]
  return methods.some((matchMethod) => {
    const match = app.router.match(matchMethod, pathname)
    return match[0].some(([[handler]]) => !isHeadFallbackHandler(handler))
  })
}

/**
 * Create a Connect-style middleware for Vite/preview servers.
 *
 * @param getApp - Lazy getter for the Hono app.
 * @param logger - Logger for request output.
 * @returns Node middleware handler.
 *
 * @example
 * import { createMiddleware } from 'mokup/vite'
 *
 * const middleware = createMiddleware(() => null, console)
 */
export function createMiddleware(
  getApp: () => Hono | null,
  logger: Logger,
  options: { getSession?: () => MockSession | undefined } = {},
) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => {
    const app = getApp()
    const session = options.getSession?.() ?? getRouteSession(app)
    if (!app && !session) {
      return next()
    }

    const url = req.url ?? '/'
    const parsedUrl = parseRequestUrl(url, req)
    if (!parsedUrl) {
      sendInvalidRequestUrl(res)
      return
    }
    const pathname = parsedUrl.pathname
    const method = normalizeMethod(req.method) ?? 'GET'

    if (!session && (!app || !hasMatch(app, method, pathname))) {
      return next()
    }

    const startedAt = Date.now()
    const controller = new AbortController()
    const abort = () => {
      if (!res.writableFinished) {
        controller.abort(new DOMException('Mock client disconnected.', 'AbortError'))
      }
    }
    req.once('aborted', abort)
    res.once('close', abort)
    try {
      const signal = session ? AbortSignal.any([controller.signal, session.signal]) : controller.signal
      const request = await toRequest(req, parsedUrl, signal)
      const response = session
        ? await session.handle(request)
        : await app!.fetch(request)
      if (!response || (!session && takeRouteSessionMiss(request))) {
        await response?.body?.cancel()
        next()
        return
      }
      // A mocked request owns its body; discard the retained copy for keep-alive.
      if (typeof req.resume === 'function') {
        req.resume()
      }
      if (response.type === 'error') {
        res.destroy()
        return
      }
      if (res.writableEnded) {
        return
      }
      await sendNodeResponse(res, response)
      logger.info(`${method} ${pathname} ${Date.now() - startedAt}ms`)
    }
    catch (error) {
      if (res.destroyed) {
        logger.error('Mock handler failed:', error)
        return
      }
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      }
      res.end('Mock handler error')
      logger.error('Mock handler failed:', error)
    }
    finally {
      req.off('aborted', abort)
      res.off('close', abort)
    }
  }
}
