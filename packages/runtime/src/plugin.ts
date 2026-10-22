import type { HttpCleanup, HttpEvents, HttpHandler, HttpResolverContext, MockSession } from './http/types'
import { isResponse } from './http/is-response'
import { withRequestSignal } from './http/request'
import { isResolverSequence, mapResolverSequence } from './http/resolver'
import { createRequestResources, withAbort } from './http/resources'

export interface MockPluginContext {
  /** Aborted before rollback or disposal begins. Setup must honor this signal. */
  signal: AbortSignal
  /** Install scoped definitions that are removed when the plugin is disposed. */
  use: (...handlers: HttpHandler[]) => void
  /** Register cleanup immediately, including for resources created before setup fails. */
  defer: (cleanup: HttpCleanup) => void
  events: Pick<HttpEvents, 'on'>
  handle: MockSession['handle']
  listHandlers: MockSession['listHandlers']
  /** Register a protocol, data, storage, or UI extension owned by this plugin. */
  registerResource: (resource: MockPluginResource) => () => Promise<void>
  /** Snapshot extension metadata without exposing resource values to hosts. */
  listResources: () => readonly MockPluginResourceInfo[]
}

export type MockPluginResourceKind = 'protocol' | 'data' | 'storage' | 'ui'

export interface MockPluginResource {
  readonly kind: MockPluginResourceKind
  readonly name: string
  readonly value: unknown
  readonly dispose?: HttpCleanup
}

export interface MockPluginResourceInfo {
  readonly kind: MockPluginResourceKind
  readonly name: string
  readonly plugin: string
}

export interface MockPlugin {
  name: string
  setup: (context: MockPluginContext) => void | HttpCleanup | Promise<void | HttpCleanup>
}

export interface MockPluginHost {
  /** Install sequentially. A failing batch rolls back only that batch in reverse order. */
  use: (...plugins: MockPlugin[]) => Promise<void>
  list: () => readonly string[]
  /** List registered extension metadata in plugin installation order. */
  listResources: () => readonly MockPluginResourceInfo[]
  /** Abort setup and plugin requests, then await setup and cleanup in reverse order. */
  dispose: () => Promise<void>
}

interface PluginRecord {
  plugin: MockPlugin
  controller: AbortController
  cleanups: HttpCleanup[]
  resources: Set<HttpCleanup>
  abortedResources?: HttpCleanup[]
  handlers: HttpHandler[]
  extensions: Map<string, MockPluginResource>
  disposal?: Promise<void> | undefined
}

function wrapHandler(handler: HttpHandler, record: PluginRecord): HttpHandler {
  return Object.freeze({
    ...handler,
    async resolver(context: HttpResolverContext) {
      const signal = AbortSignal.any([context.request.signal, record.controller.signal])
      signal.throwIfAborted()
      const scope = createRequestResources(signal, cleanup => record.resources.delete(cleanup))
      record.resources.add(scope.finish)
      context.finalize(scope.finish)
      try {
        const result = await withAbort(Promise.resolve().then(() => handler.resolver({
          ...context,
          request: withRequestSignal(context.request, signal),
          finalize: scope.finalize,
        })), signal)
        if (isResolverSequence(result)) {
          const sequence = mapResolverSequence(result, async (value) => {
            if (!isResponse(value)) {
              return value
            }
            const responseScope = createRequestResources(signal, cleanup => record.resources.delete(cleanup))
            record.resources.add(responseScope.finish)
            scope.finalize(responseScope.finish)
            return await responseScope.observe(value)
          })
          scope.finalize(async () => {
            await sequence.return(undefined)
          })
          return sequence
        }
        if (isResponse(result)) {
          return await scope.observe(result)
        }
        await scope.finish()
        return result
      }
      catch (error) {
        await scope.finish()
        throw error
      }
    },
  })
}

/** Add extensions to a caller-owned HTTP session without resetting its definitions. */
export function createPluginHost(session: MockSession): MockPluginHost {
  const records = new Map<string, PluginRecord>()
  const resources = new Map<string, MockPluginResourceInfo>()
  let closing = false
  let queue = Promise.resolve()
  let disposal: Promise<void> | undefined

  const abort = (record: PluginRecord, reason: DOMException) => {
    if (!record.controller.signal.aborted) {
      record.abortedResources = [...record.resources]
      record.controller.abort(reason)
    }
  }

  const cleanup = (record: PluginRecord) => {
    record.disposal ??= Promise.resolve().then(async () => {
      abort(record, new DOMException(`Mock plugin ${record.plugin.name} disposed.`, 'AbortError'))
      const failures: unknown[] = []
      session.removeHandlers(...record.handlers)
      const resourceCleanups = new Set([...record.abortedResources ?? [], ...record.resources])
      for (const release of [...resourceCleanups, ...record.cleanups.reverse()]) {
        try {
          await release()
        }
        catch (error) {
          failures.push(error)
        }
      }
      record.cleanups.length = 0
      record.handlers.length = 0
      record.extensions.clear()
      records.delete(record.plugin.name)
      if (failures.length) {
        throw new AggregateError(failures, `Mock plugin ${record.plugin.name} cleanup failed.`)
      }
    })
    return record.disposal
  }

  const rollback = async (batch: PluginRecord[]) => {
    const failures: unknown[] = []
    for (const record of [...batch].reverse()) {
      try {
        await cleanup(record)
      }
      catch (error) {
        failures.push(error)
      }
    }
    if (failures.length) {
      throw new AggregateError(failures, 'Mock plugin rollback failed.')
    }
  }

  const setup = async (record: PluginRecord) => {
    const assertActive = () => record.controller.signal.throwIfAborted()
    assertActive()
    const context: MockPluginContext = {
      signal: record.controller.signal,
      use(...handlers) {
        assertActive()
        const wrapped = handlers.map(handler => wrapHandler(handler, record))
        session.use(...wrapped)
        record.handlers.push(...wrapped)
      },
      defer(release) {
        assertActive()
        record.cleanups.push(release)
      },
      events: {
        on(type, listener) {
          assertActive()
          const remove = session.events.on(type, listener)
          record.cleanups.push(remove)
          return remove
        },
      },
      handle(request, context) {
        assertActive()
        return session.handle(withRequestSignal(request, AbortSignal.any([request.signal, record.controller.signal])), context)
      },
      listHandlers: session.listHandlers,
      registerResource(resource) {
        assertActive()
        if (!resource || typeof resource !== 'object' || !['protocol', 'data', 'storage', 'ui'].includes(resource.kind) || !resource.name.trim()) {
          throw new TypeError('Mock plugin resources require a supported kind and nonempty name.')
        }
        const key = `${resource.kind}:${resource.name}`
        if (resources.has(key)) {
          throw new Error(`Mock plugin resource names must be unique: "${key}".`)
        }
        const info: MockPluginResourceInfo = { kind: resource.kind, name: resource.name, plugin: record.plugin.name }
        resources.set(key, info)
        record.extensions.set(key, resource)
        let active = true
        const unregister = async () => {
          if (!active) {
            return
          }
          active = false
          resources.delete(key)
          record.extensions.delete(key)
          await resource.dispose?.()
        }
        record.cleanups.push(unregister)
        return unregister
      },
      listResources: () => Object.freeze([...resources.values()]),
    }
    const release = await record.plugin.setup(context)
    if (release) {
      record.cleanups.push(release)
    }
    assertActive()
  }

  return {
    use(...plugins) {
      if (closing) {
        return Promise.reject(new Error('Cannot install plugins on a disposed plugin host.'))
      }
      const names = new Set(records.keys())
      for (const plugin of plugins) {
        if (!plugin.name.trim() || names.has(plugin.name)) {
          return Promise.reject(new Error(`Mock plugin names must be nonempty and unique: "${plugin.name}".`))
        }
        names.add(plugin.name)
      }
      const batch = plugins.map(plugin => ({ plugin, controller: new AbortController(), cleanups: [], resources: new Set<HttpCleanup>(), extensions: new Map<string, MockPluginResource>(), handlers: [] } as PluginRecord))
      for (const record of batch) {
        records.set(record.plugin.name, record)
      }
      const operation = queue.then(async () => {
        try {
          for (const record of batch) {
            await setup(record)
          }
        }
        catch (error) {
          try {
            await rollback(batch)
          }
          catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'Mock plugin initialization and rollback failed.')
          }
          throw error
        }
      })
      queue = operation.catch(() => undefined)
      return operation
    },
    list: () => Object.freeze([...records.keys()]),
    listResources: () => Object.freeze([...resources.values()]),
    dispose() {
      if (!disposal) {
        closing = true
        for (const record of records.values()) {
          abort(record, new DOMException('Mock plugin host disposed.', 'AbortError'))
        }
        disposal = queue.then(() => rollback([...records.values()]))
      }
      return disposal
    },
  }
}
