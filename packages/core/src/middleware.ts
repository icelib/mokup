import type { Context } from '@mokup/shared/hono'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Logger, ResolvedRoute, RouteTable } from './shared/types'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { isHeadFallbackHandler, prioritizeHeadRoutes } from '@mokup/shared/head-routes'
import { Hono, PatternRouter } from '@mokup/shared/hono'
import { registerTokenRoute } from '@mokup/shared/hono-routes'
import { applyContextResponseOverrides } from '@mokup/shared/response-overrides'
import { readStreamBody } from '@mokup/shared/stream-body'
import { parseRequestUrl, sendInvalidRequestUrl } from './shared/request-url'
import { delay, normalizeMethod } from './shared/utils'

function resolveResponse(value: unknown, fallback: Response) {
  if (value instanceof Response) {
    return value
  }
  if (value && typeof value === 'object' && 'res' in value) {
    const resolved = (value as { res?: unknown }).res
    if (resolved instanceof Response) {
      return resolved
    }
  }
  return fallback
}

function normalizeHandlerValue(c: Context, value: unknown): Response {
  if (value instanceof Response) {
    return value
  }
  if (typeof value === 'undefined') {
    const response = c.body(null)
    if (response.status === 200) {
      return new Response(response.body, {
        status: 204,
        headers: response.headers,
      })
    }
    return response
  }
  if (typeof value === 'string') {
    return c.text(value)
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    if (!c.res.headers.get('content-type')) {
      c.header('content-type', 'application/octet-stream')
    }
    const data = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value)
    return c.body(data)
  }
  return c.json(value)
}

function createRouteHandler(route: ResolvedRoute) {
  return async (c: Context) => {
    const value = typeof route.handler === 'function'
      ? await route.handler(c)
      : route.handler
    return normalizeHandlerValue(c, value)
  }
}

function createFinalizeMiddleware(route: ResolvedRoute) {
  return async (c: Context, next: () => Promise<Response | void>) => {
    const response = await next()
    const resolved = resolveResponse(response, c.res)
    if (route.delay && route.delay > 0) {
      await delay(route.delay)
    }
    return applyContextResponseOverrides(c, resolved, route)
  }
}

function wrapMiddleware(
  handler: (c: Context, next: () => Promise<void>) => Promise<Response | void>,
) {
  return async (c: Context, next: () => Promise<void>) => {
    const response = await handler(c, next)
    return resolveResponse(response, c.res)
  }
}

function splitRouteMiddlewares(route: ResolvedRoute) {
  const before: Array<ReturnType<typeof wrapMiddleware>> = []
  const normal: Array<ReturnType<typeof wrapMiddleware>> = []
  const after: Array<ReturnType<typeof wrapMiddleware>> = []
  for (const entry of route.middlewares ?? []) {
    const wrapped = wrapMiddleware(entry.handle)
    if (entry.position === 'post') {
      after.push(wrapped)
    }
    else if (entry.position === 'pre') {
      before.push(wrapped)
    }
    else {
      normal.push(wrapped)
    }
  }
  return { before, normal, after }
}

/**
 * Build a Hono app for the resolved route table.
 *
 * @param routes - Resolved route table.
 * @returns Hono app instance.
 *
 * @example
 * import { createHonoApp } from 'mokup/vite'
 *
 * const app = createHonoApp([])
 */
export function createHonoApp(routes: RouteTable): Hono {
  const app = new Hono({ router: new PatternRouter(), strict: false })

  for (const route of prioritizeHeadRoutes(routes)) {
    const { before, normal, after } = splitRouteMiddlewares(route)
    registerTokenRoute(
      app,
      route.method,
      route.tokens ?? [],
      [createFinalizeMiddleware(route), ...before, ...normal, ...after, createRouteHandler(route)],
    )
  }

  return app
}

function buildHeaders(headers: IncomingMessage['headers']) {
  const result = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'undefined') {
      continue
    }
    if (Array.isArray(value)) {
      result.set(key, value.join(','))
    }
    else {
      result.set(key, value)
    }
  }
  return result
}

async function toRequest(req: IncomingMessage, url: URL) {
  const method = req.method ?? 'GET'
  const headers = buildHeaders(req.headers)
  const init: RequestInit = { method, headers }
  const rawBody = await readStreamBody(req)
  if (rawBody && method !== 'GET' && method !== 'HEAD') {
    init.body = rawBody as BodyInit
  }
  return new Request(url.toString(), init)
}

async function sendResponse(res: ServerResponse, response: Response) {
  const buffer = response.body ? new Uint8Array(await response.arrayBuffer()) : null
  const cookies = response.headers.getSetCookie()
  const headers = Array.from(response.headers).filter(([key]) => key !== 'set-cookie')
  for (const [key, value] of headers) {
    validateHeaderName(key)
    validateHeaderValue(key, value)
  }
  for (const cookie of cookies) {
    validateHeaderValue('set-cookie', cookie)
  }
  res.statusCode = response.status
  for (const [key, value] of headers) {
    res.setHeader(key, value)
  }
  if (cookies.length > 0) {
    res.setHeader('set-cookie', cookies)
  }
  if (!buffer) {
    res.end()
    return
  }
  res.end(buffer)
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
) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => {
    const app = getApp()
    if (!app) {
      return next()
    }

    const url = req.url ?? '/'
    const parsedUrl = parseRequestUrl(url)
    if (!parsedUrl) {
      sendInvalidRequestUrl(res)
      return
    }
    const pathname = parsedUrl.pathname
    const method = normalizeMethod(req.method) ?? 'GET'

    if (!hasMatch(app, method, pathname)) {
      return next()
    }

    const startedAt = Date.now()
    try {
      const response = await app.fetch(await toRequest(req, parsedUrl))
      if (res.writableEnded) {
        return
      }
      await sendResponse(res, response)
      logger.info(`${method} ${pathname} ${Date.now() - startedAt}ms`)
    }
    catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      }
      res.end('Mock handler error')
      logger.error('Mock handler failed:', error)
    }
  }
}
