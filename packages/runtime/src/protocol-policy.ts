import type { ProtocolEvent, ProtocolUnhandledPolicy, ProtocolUnhandledResult, UnhandledRequestContext } from './http/types'
import { withAbort } from './http/resources'

export function protocolUnhandled(event: ProtocolEvent, reason: string, policy?: ProtocolUnhandledPolicy): ProtocolUnhandledResult {
  return Object.freeze({
    kind: 'mokup:protocol-unhandled' as const,
    event: Object.freeze({ ...event }),
    reason,
    ...(policy === undefined ? {} : { policy }),
  })
}

export async function applyProtocolUnhandledPolicy(
  policy: ProtocolUnhandledPolicy | undefined,
  event: ProtocolEvent,
  context: UnhandledRequestContext,
): Promise<void> {
  if (typeof policy === 'function') {
    await withAbort(Promise.resolve().then(() => policy(event, context)), context.signal)
    return
  }
  const strategy = policy ?? 'bypass'
  if (strategy === 'warn') {
    // eslint-disable-next-line no-console -- Explicit warning policy is part of the protocol API.
    console.warn(`[mokup] Unhandled ${event.protocol} operation: ${event.method} ${event.url}`)
  }
  else if (strategy === 'error') {
    throw new Error(`[mokup] Unhandled ${event.protocol} operation: ${event.method} ${event.url}`)
  }
}
