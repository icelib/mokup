import type { HttpEventMap, HttpEvents } from 'mokup/http'
import type { LifeCycleEventEmitter, LifeCycleEventMap } from './compat-types'

function fallbackRequest(event: { method: string, url: string, request?: Request }) {
  return event.request ?? new Request(event.url, { method: event.method })
}

/** Adapt Mokup metadata events to the Request/Response payloads exposed by MSW. */
export function createLifecycleEmitter(source: HttpEvents): LifeCycleEventEmitter {
  const listeners = new Map<keyof LifeCycleEventMap, Set<(event: never) => void>>()

  const publish = <Type extends keyof LifeCycleEventMap>(type: Type, event: LifeCycleEventMap[Type]) => {
    for (const listener of [...listeners.get(type) ?? []]) {
      listener(Object.freeze(event) as never)
    }
  }

  const forward = <SourceType extends keyof HttpEventMap, TargetType extends keyof LifeCycleEventMap>(sourceType: SourceType, targetType: TargetType, transform: (event: HttpEventMap[SourceType]) => LifeCycleEventMap[TargetType]) => {
    source.on(sourceType, event => publish(targetType, transform(event)))
  }

  forward('request:start', 'request:start', event => ({ request: fallbackRequest(event), requestId: event.requestId }))
  forward('request:match', 'request:match', event => ({ request: fallbackRequest(event), requestId: event.requestId }))
  forward('request:unhandled', 'request:unhandled', event => ({ request: fallbackRequest(event), requestId: event.requestId }))
  forward('request:end', 'request:end', event => ({ request: fallbackRequest(event), requestId: event.requestId }))
  forward('response:mocked', 'response:mocked', event => ({
    request: fallbackRequest(event),
    response: event.response ?? (event.status === 0 ? Response.error() : new Response(null, { status: event.status })),
    requestId: event.requestId,
  }))
  forward('response:bypass', 'response:bypass', event => ({ request: fallbackRequest(event), requestId: event.requestId }))
  forward('unhandledException', 'unhandledException', event => ({ error: event.error, request: fallbackRequest(event), requestId: event.requestId }))

  const emitter: LifeCycleEventEmitter = {
    on(type, listener) {
      let group = listeners.get(type)
      if (!group) {
        group = new Set()
        listeners.set(type, group)
      }
      group.add(listener as (event: never) => void)
      return () => emitter.removeListener(type, listener)
    },
    removeListener(type, listener) {
      listeners.get(type)?.delete(listener as (event: never) => void)
    },
    removeAllListeners(type) {
      if (type) {
        listeners.delete(type)
        return
      }
      listeners.clear()
    },
  }

  return emitter
}
