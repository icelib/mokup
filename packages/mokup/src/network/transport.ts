import type { MockSession } from '@mokup/runtime/http'
import type { HttpRequestEventMap, Interceptor } from '@mswjs/interceptors'
import { BatchInterceptor, RequestController } from '@mswjs/interceptors'

type HttpInterceptor = Interceptor<HttpRequestEventMap>
type RequestEvent = HttpRequestEventMap['request'][0]

interface Registration {
  session: () => MockSession
  pending: Set<Promise<void>>
}

/** Share global interception without allowing one session to tear down another. */
export function createHttpTransport(name: string, interceptors: () => HttpInterceptor[], changed: () => void = () => {}) {
  const registrations: Registration[] = []
  let batch: BatchInterceptor<HttpInterceptor[]> | undefined

  async function dispatch({ request, controller }: RequestEvent, session: MockSession) {
    try {
      const response = await session.handle(request)
      if (response && controller.readyState === RequestController.PENDING) {
        // Server adapters can replace global Response after handlers are created.
        // Detect the error type without the interceptor's instanceof boundary.
        if (response.type === 'error') {
          controller.errorWith(new TypeError('Failed to fetch'))
        }
        else {
          controller.respondWith(response)
        }
      }
    }
    catch (error) {
      // The interceptor owns caller aborts. Racing its abort listener with
      // errorWith() would settle the same controller twice and orphan fetch's
      // internal response promise in browsers.
      if (!request.signal.aborted && controller.readyState === RequestController.PENDING) {
        controller.errorWith(error)
      }
    }
  }

  function attach(session: () => MockSession) {
    const registration: Registration = { session, pending: new Set() }
    if (!batch) {
      const next = new BatchInterceptor({ name, interceptors: interceptors() })
      next.on('request', async (event) => {
        const active = registrations.at(-1)
        if (!active || event.controller.readyState !== RequestController.PENDING) {
          return
        }
        // Resolve the boundary/generation synchronously while the interceptor
        // callback still carries the caller's async context. Reading it later
        // inside an async dispatch lets parallel boundaries cross-consume
        // once handlers and can switch a closing request to another session.
        let session: MockSession
        try {
          session = active.session()
        }
        catch {
          return
        }
        const task = dispatch(event, session)
        active.pending.add(task)
        try {
          await task
        }
        finally {
          active.pending.delete(task)
        }
      })
      try {
        next.apply()
        changed()
        batch = next
      }
      catch (error) {
        next.dispose()
        changed()
        throw error
      }
    }
    registrations.push(registration)
    let closing: Promise<void> | undefined
    return () => {
      if (!closing) {
        const index = registrations.indexOf(registration)
        if (index !== -1) {
          registrations.splice(index, 1)
        }
        // Restore the globals synchronously. Already intercepted requests still
        // own their controllers and settle through their session's disposal.
        if (registrations.length === 0) {
          batch?.dispose()
          batch = undefined
          changed()
        }
        closing = Promise.allSettled(registration.pending).then(() => undefined)
      }
      return closing
    }
  }

  return { attach }
}
