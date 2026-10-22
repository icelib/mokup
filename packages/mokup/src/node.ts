import type { HttpHandler, MockSession } from '@mokup/runtime/http'
import type { NetworkController, NetworkOptions, NetworkSessionOptions } from './network/session'
import { AsyncLocalStorage } from 'node:async_hooks'
import { syncBuiltinESMExports } from 'node:module'
import { ClientRequestInterceptor } from '@mswjs/interceptors/ClientRequest'
import { FetchInterceptor } from '@mswjs/interceptors/fetch'
import { XMLHttpRequestInterceptor } from '@mswjs/interceptors/XMLHttpRequest'
import { createNetworkSession } from './network/session'
import { createHttpTransport } from './network/transport'

const transport = createHttpTransport('mokup-node', () => [
  new ClientRequestInterceptor(),
  new XMLHttpRequestInterceptor(),
  new FetchInterceptor(),
], syncBuiltinESMExports)

export interface SetupServer extends NetworkController {
  listen: (options?: NetworkOptions) => void
  close: () => Promise<void>
  /** Isolate handlers and once consumption for the full asynchronous callback. */
  boundary: <Args extends unknown[], Result>(callback: (...args: Args) => Result) => (...args: Args) => Promise<Awaited<Result>>
}

export type SetupServerOptions = NetworkSessionOptions

function splitInput(input: readonly (HttpHandler | SetupServerOptions)[]) {
  const last = input.at(-1)
  if (last && !('resolver' in last)) {
    return { handlers: input.slice(0, -1) as HttpHandler[], options: last }
  }
  return { handlers: input as HttpHandler[], options: {} }
}

/** Intercept outgoing Node requests without changing application request clients. */
export function setupServer(...input: HttpHandler[]): SetupServer
export function setupServer(...input: [...HttpHandler[], SetupServerOptions]): SetupServer
export function setupServer(...input: (HttpHandler | SetupServerOptions)[]): SetupServer {
  const { handlers, options } = splitInput(input)
  const scope = new AsyncLocalStorage<MockSession>()
  const session = createNetworkSession(handlers, () => scope.getStore(), options)
  return {
    ...session.controller,
    get readyState() { return session.controller.readyState },
    listen: options => session.start(transport.attach, options),
    close: session.stop,
    boundary: callback => async (...args): Promise<Awaited<ReturnType<typeof callback>>> => {
      const boundary = session.fork()
      try {
        return await scope.run(boundary.session, () => callback(...args))
      }
      finally {
        await boundary.dispose()
      }
    },
  }
}

export type { NetworkOptions, NetworkSessionOptions } from './network/session'
