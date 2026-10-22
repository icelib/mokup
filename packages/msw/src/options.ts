import type { UnhandledRequestPolicy } from 'mokup/http'

export interface UnhandledPrint {
  warning: () => void
  error: () => void
}

export interface UnhandledHttpFrame {
  readonly protocol: 'http'
  readonly data: { readonly id: string, readonly request: Request }
  passthrough: () => void
  errorWith: (reason?: unknown) => void
  getUnhandledMessage: () => Promise<string>
}

export type UnhandledFramePolicy = 'bypass' | 'warn' | 'error' | ((context: {
  frame: UnhandledHttpFrame
  defaults: { warn: () => void, error: () => void }
}) => void | Promise<void>)

export type UnhandledRequestCompatibilityPolicy = 'bypass' | 'warn' | 'error' | ((request: Request, print: UnhandledPrint) => void | Promise<void>)

export interface CompatibilityOptions {
  /** MSW 3 HTTP frame policy. Defaults to warn. */
  onUnhandledFrame?: UnhandledFramePolicy
  /** MSW 2 request policy alias. */
  onUnhandledRequest?: UnhandledRequestCompatibilityPolicy
}

export function normalizeOptions(options: CompatibilityOptions = {}) {
  for (const key of Object.keys(options)) {
    if (key !== 'onUnhandledRequest' && key !== 'onUnhandledFrame') {
      throw new TypeError(`@mokup/msw does not support the ${key} option. See the HTTP migration compatibility table.`)
    }
  }
  for (const policy of [options.onUnhandledFrame, options.onUnhandledRequest]) {
    if (policy !== undefined && typeof policy !== 'function' && !['bypass', 'warn', 'error'].includes(policy)) {
      throw new TypeError('@mokup/msw requires a string unhandled strategy or callback.')
    }
  }
  if (options.onUnhandledFrame !== undefined && options.onUnhandledRequest !== undefined && options.onUnhandledFrame !== options.onUnhandledRequest) {
    throw new TypeError('@mokup/msw received conflicting onUnhandledFrame and onUnhandledRequest policies.')
  }
  const policy = options.onUnhandledFrame ?? options.onUnhandledRequest ?? 'warn'
  if (typeof policy !== 'function') {
    return { onUnhandled: policy }
  }
  const onUnhandled: UnhandledRequestPolicy = async (event, context) => {
    const request = await context.request()
    const message = `[mokup] Unhandled request: ${event.method} ${event.url}`
    const print = {
      // eslint-disable-next-line no-console -- Explicit compatibility policy.
      warning: () => console.warn(message),
      // MSW's callback helpers print without changing resolution; throwing rejects it.
      // eslint-disable-next-line no-console -- Explicit compatibility policy.
      error: () => console.error(message),
    }
    if (typeof options.onUnhandledFrame === 'function') {
      const frame: UnhandledHttpFrame = {
        protocol: 'http',
        data: { id: event.requestId, request },
        passthrough: () => {},
        errorWith(reason) {
          throw reason ?? new TypeError('Unhandled HTTP frame rejected.')
        },
        getUnhandledMessage: async () => message,
      }
      await options.onUnhandledFrame({ frame, defaults: { warn: print.warning, error: print.error } })
    }
    else if (typeof options.onUnhandledRequest === 'function') {
      await options.onUnhandledRequest(request, print)
    }
  }
  return { onUnhandled }
}
