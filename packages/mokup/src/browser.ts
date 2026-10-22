import type { HttpHandler } from '@mokup/runtime/http'
import type { ServiceWorkerOptions } from './network/service-worker'
import type { NetworkController, NetworkOptions, NetworkSessionOptions } from './network/session'
import { FetchInterceptor } from '@mswjs/interceptors/fetch'
import { XMLHttpRequestInterceptor } from '@mswjs/interceptors/XMLHttpRequest'
import { createBrowserCookies } from './network/browser-cookies'
import { attachEventSource } from './network/event-source'
import { attachServiceWorker } from './network/service-worker'
import { createNetworkSession } from './network/session'
import { createHttpTransport } from './network/transport'

const transport = createHttpTransport('mokup-browser', () => [
  new FetchInterceptor(),
  new XMLHttpRequestInterceptor(),
])

export interface SetupWorker extends NetworkController {
  readonly mode: 'serviceWorker' | 'interceptor'
  start: (options?: WorkerStartOptions) => Promise<void>
  stop: () => Promise<void>
}

export type SetupWorkerOptions = NetworkSessionOptions

function splitInput(input: readonly (HttpHandler | SetupWorkerOptions)[]) {
  const last = input.at(-1)
  if (last && !('resolver' in last)) {
    return { handlers: input.slice(0, -1) as HttpHandler[], options: last }
  }
  return { handlers: input as HttpHandler[], options: {} }
}

export interface WorkerStartOptions extends NetworkOptions {
  /** Defaults to a network-level Service Worker. The in-page fallback is explicit. */
  mode?: 'serviceWorker' | 'interceptor'
  serviceWorker?: ServiceWorkerOptions
}

/** Execute handlers in the page while intercepting requests at the network layer. */
export function setupWorker(...input: HttpHandler[]): SetupWorker
export function setupWorker(...input: [...HttpHandler[], SetupWorkerOptions]): SetupWorker
export function setupWorker(...input: (HttpHandler | SetupWorkerOptions)[]): SetupWorker {
  const { handlers, options: sessionOptions } = splitInput(input)
  const session = createNetworkSession(handlers, undefined, sessionOptions)
  let mode: SetupWorker['mode'] = 'serviceWorker'
  let starting: Promise<void> | undefined
  let cookies: ReturnType<typeof createBrowserCookies> | undefined
  const stop = () => {
    cookies?.clear()
    cookies = undefined
    return session.stop()
  }
  return {
    ...session.controller,
    get readyState() { return session.controller.readyState },
    get mode() { return mode },
    start(options = {}) {
      if (starting) {
        return starting
      }
      if (session.controller.readyState === 'started') {
        return Promise.resolve()
      }
      mode = options.mode ?? 'serviceWorker'
      const nextCookies = createBrowserCookies()
      cookies = nextCookies
      if (mode === 'interceptor') {
        let eventSourceDetach: (() => Promise<void>) | undefined
        let transportDetach: (() => Promise<void>) | undefined
        try {
          session.start((current) => {
            eventSourceDetach = attachEventSource(() => nextCookies.wrap(current()))
            try {
              transportDetach = transport.attach(() => nextCookies.wrap(current()))
            }
            catch (error) {
              void eventSourceDetach?.()
              eventSourceDetach = undefined
              throw error
            }
            return async () => {
              await eventSourceDetach?.()
              await transportDetach?.()
            }
          }, options)
        }
        catch (error) {
          nextCookies.clear()
          cookies = undefined
          return Promise.reject(error)
        }
        return Promise.resolve()
      }
      let connected: Promise<() => Promise<void>> | undefined
      session.start((current) => {
        connected = attachServiceWorker(() => nextCookies.wrap(current()), options.serviceWorker)
        return () => connected!.then(detach => detach(), () => undefined)
      }, options)
      starting = connected!.then(() => undefined, async (error: unknown) => {
        await stop()
        throw error
      }).finally(() => { starting = undefined })
      return starting
    },
    stop,
  }
}

export type { ServiceWorkerOptions } from './network/service-worker'
export type { NetworkOptions, NetworkSessionOptions } from './network/session'
