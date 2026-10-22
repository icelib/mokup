import type { HttpHandler, MockSession, UnhandledRequestPolicy } from '@mokup/runtime/http'
import { Buffer } from 'node:buffer'
import { createMockSession } from '@mokup/runtime/http'
import { playwrightBodyLimits, readPlaywrightBody } from './playwright-body'

export interface PlaywrightRequest {
  url: () => string
  method: () => string
  allHeaders: () => Promise<Record<string, string>>
  postDataBuffer: () => Uint8Array | null
}

export interface PlaywrightRoute {
  request: () => PlaywrightRequest
  fallback: () => Promise<void>
  abort: (errorCode?: string) => Promise<void>
  fulfill: (response: { status: number, headers: Record<string, string>, body: Buffer }) => Promise<void>
}

type RouteHandler = (route: PlaywrightRoute) => Promise<void>

/** Structural subset satisfied by Playwright BrowserContext and Page. */
export interface PlaywrightRouteTarget {
  route: (pattern: string | RegExp, handler: RouteHandler) => Promise<unknown>
  unroute: (pattern: string | RegExp, handler: RouteHandler) => Promise<void>
}

export interface PlaywrightMockOptions {
  handlers?: readonly HttpHandler[]
  onUnhandled?: UnhandledRequestPolicy
  pattern?: string | RegExp
  maxBodyBytes?: number
  bodyTimeoutMs?: number
}

export interface PlaywrightMockController extends Pick<MockSession, 'events' | 'use' | 'resetHandlers' | 'restoreHandlers' | 'listHandlers'> {
  /** Removes only this adapter's route and disposes its session; rejects recorded failures. */
  detach: () => Promise<void>
  errors: () => readonly Error[]
}

/** Route page/context HTTP traffic through an isolated Mokup session. Prefer a context. */
export async function attachPlaywright(target: PlaywrightRouteTarget, options: PlaywrightMockOptions = {}): Promise<PlaywrightMockController> {
  const { maxBodyBytes, bodyTimeoutMs } = playwrightBodyLimits(options.maxBodyBytes, options.bodyTimeoutMs)
  const session = createMockSession({
    handlers: options.handlers ?? [],
    ...(options.onUnhandled === undefined ? {} : { onUnhandled: options.onUnhandled }),
  })
  const pattern = options.pattern ?? '**/*'
  const failures: Error[] = []
  const pending = new Set<Promise<void>>()
  let detached = false
  let disposal: Promise<void> | undefined

  const handle = async (route: PlaywrightRoute) => {
    try {
      if (detached) {
        await route.fallback()
        return
      }
      const source = route.request()
      const bytes = source.postDataBuffer()
      if ((bytes?.byteLength ?? 0) > maxBodyBytes) {
        throw new RangeError(`Playwright mock request exceeds ${maxBodyBytes} bytes.`)
      }
      const request = new Request(source.url(), {
        method: source.method(),
        headers: await source.allHeaders(),
        body: bytes === null ? null : new Uint8Array(bytes),
      })
      const response = await session.handle(request)
      if (!response) {
        await route.fallback()
        return
      }
      if (response.type === 'error') {
        await route.abort('failed')
        return
      }
      if (response.headers.getSetCookie().length > 1) {
        void response.body?.cancel().catch(() => undefined)
        throw new Error('Playwright fulfill cannot represent multiple Set-Cookie fields in this adapter; use a server or Service Worker transport.')
      }
      const body = await readPlaywrightBody(response, maxBodyBytes, bodyTimeoutMs)
      const headers = Object.fromEntries(response.headers)
      delete headers['content-length']
      delete headers['transfer-encoding']
      delete headers['content-encoding']
      await route.fulfill({ status: response.status, headers, body: Buffer.from(body) })
    }
    catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      failures.push(error)
      try {
        await route.abort('failed')
      }
      catch (abortError) {
        failures.push(abortError instanceof Error ? abortError : new Error(String(abortError)))
      }
    }
  }
  const routeHandler: RouteHandler = (route) => {
    const task = handle(route)
    pending.add(task)
    void task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  }
  try {
    await target.route(pattern, routeHandler)
  }
  catch (error) {
    await session.dispose()
    throw error
  }
  return {
    events: session.events,
    use: session.use,
    resetHandlers: session.resetHandlers,
    restoreHandlers: session.restoreHandlers,
    listHandlers: session.listHandlers,
    errors: () => [...failures],
    detach() {
      if (!disposal) {
        detached = true
        disposal = (async () => {
          const cleanup = await Promise.allSettled([target.unroute(pattern, routeHandler), session.dispose()])
          await Promise.allSettled(pending)
          for (const result of cleanup) {
            if (result.status === 'rejected') {
              failures.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)))
            }
          }
          if (failures.length) {
            throw new AggregateError(failures, 'Playwright mocking failed; inspect errors for request and cleanup details.')
          }
        })()
      }
      return disposal
    },
  }
}
