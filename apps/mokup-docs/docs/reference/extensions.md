# Diagnostics and plugins

These APIs operate on an HTTP `MockSession` or a shared protocol event bus. For a manifest runtime, use `await runtime.ready()` to access its session. They do not install network interception or a WebSocket controller.

## Diagnostics

```ts
import { createDiagnosticsCollector } from 'mokup/diagnostics'
import { createMockSession, http, HttpResponse } from 'mokup/http'

const session = createMockSession(
  http.get('/users', () => HttpResponse.json([])),
)
const diagnostics = createDiagnosticsCollector(session, { maxEntries: 500 })

const response = await session.handle(new Request('https://example.test/users'))
await response?.json()
const snapshot = diagnostics.snapshot()
const json = diagnostics.serialize()

diagnostics.dispose()
await session.dispose()
```

The versioned snapshot contains `timeline`, `handlers`, and `totals`. Timeline entries are the actual HTTP events, with sequence, timestamp, request ID, method, URL, and relevant handler ID/status/error metadata. Join entries by `requestId` to follow concurrent requests. `maxEntries` bounds the number of retained **events**, not requests, so a retained request can have its earliest events evicted.

Handler coverage distinguishes `matched` from `mocked`: a matched resolver can return `undefined` and fall through. `active` indicates whether that definition is currently registered. Definitions that were never exercised appear with zero counts; removed definitions retain their historical counts until `clear()`. Aggregate totals remain available after timeline eviction. An unhandled entry includes `decisionChain`, preserving the ordered method and matcher decisions (`method-mismatch`, `once-exhausted`, `matcher-mismatch`, or `matcher-error`) and an actionable detail when one is available. A concurrent request that loses a `once` race is recorded as `once-exhausted` only after the winning request has consumed the handler.

`snapshot()` returns independent data copies. `serialize()` produces JSON without handler functions, body streams, body contents, or exception stacks. URLs and error messages remain intact; redact them before exposing diagnostic data externally if your application puts sensitive data there. `clear()` resets entries and counts. `dispose()` removes only the collector's own listeners and preserves its final snapshot.

`request:end` marks completion of response resolution. It does not mean a streamed response has finished reaching its consumer. Coverage counts a produced mock response, not successful stream consumption. Protocol adapters can emit shared `protocol:*` lifecycle entries through the session event bus; those entries carry protocol and connection metadata, preserve unhandled reasons, and never include body contents. A protocol-only collector can be created with `{ events: controller.events }` when handler coverage is not needed.

## Scenarios and isolated forks

Bind a named scenario catalog to a session when handlers need deterministic state or controlled variants. The session clones catalogs that expose `fork()`, so `session.fork()` can select a different scenario without changing its parent.

```ts
import { createMockSession, http, HttpResponse } from 'mokup/http'
import { createScenario, createScenarioCatalog } from 'mokup/scenario'

const scenarios = createScenarioCatalog({
  happy: createScenario('happy', { status: 200 }),
  outage: createScenario('outage', { status: 503 }),
})
const session = createMockSession({
  scenario: scenarios,
  handlers: [http.get('/status', ({ scenario }) => HttpResponse.json(scenario?.current().getState()))],
})

session.selectScenario('outage')
const isolated = session.fork()
isolated.selectScenario('happy')
```

`scenario` is available on native and file HTTP resolver contexts. `selectScenario`, `resetScenario`, and `session.scenario` provide runtime controls; use `runtime.selectScenario(...)` for a manifest runtime before or after `ready()`.

Network controllers can bind the same catalog when they are created. Pass the
catalog as the final options argument to `setupServer` or `setupWorker`; the
controls then apply to the persistent definitions and the currently attached
transport session. Service Worker sessions keep the selection when they stop
and start again.

```ts
const worker = setupWorker(
  http.get('/status', ({ scenario }) => HttpResponse.json(scenario?.current().getState())),
  { scenario: scenarios },
)

await worker.start()
worker.selectScenario('outage')
worker.resetScenario()
await worker.stop()
```

## Plugin host

```ts
import { http, HttpResponse } from 'mokup/http'
import { createPluginHost } from 'mokup/plugin'

const plugins = createPluginHost(session)
await plugins.use({
  name: 'health-check',
  setup({ use, defer, events, signal }) {
    use(http.get('/health', () => HttpResponse.json({ ok: true })))
    const timer = setInterval(() => {
      if (signal.aborted) {
        clearInterval(timer)
      }
      // Maintain plugin-owned state.
    }, 1000)
    defer(() => clearInterval(timer))
    events.on('request:unhandled', (event) => {
      // Observe event.method and event.url without consuming a request body.
    })
    return () => {
      // Optional additional synchronous or asynchronous cleanup.
    }
  },
})

await plugins.dispose()
await session.dispose()
```

Plugins have unique, nonempty names and a typed `setup(context)` function. A setup can return a disposer or a promise of one. `context.use` installs scoped handler definitions; `context.events.on` tracks subscriptions; `context.defer` registers cleanup immediately, including for resources created before setup later fails. The context also exposes `signal`, `handle(request)`, and `listHandlers()`.

Protocol, data-source, storage, and panel integrations can register a namespaced resource without coupling the runtime to that integration:

```ts
await plugins.use({
  name: 'fixtures-storage',
  setup({ registerResource }) {
    const store = new Map<string, unknown>()
    registerResource({
      kind: 'storage',
      name: 'fixtures',
      value: store,
      dispose: () => store.clear(),
    })
  },
})

plugins.listResources()
// [{ kind: 'storage', name: 'fixtures', plugin: 'fixtures-storage' }]
```

Resource names are unique per kind across the host. The returned unregister function and the optional `dispose` callback run during rollback or host disposal. `listResources()` exposes metadata only, so panel hosts can discover extensions without receiving their values.

Plugins in each `use(...)` batch initialize sequentially. A failed batch rolls back in reverse order while preserving earlier successful batches. Names are reserved before asynchronous setup, so concurrent installations cannot claim the same name. Register resource cleanup with `defer` as soon as the resource exists; a disposer that setup never returns cannot be recovered automatically.

`dispose()` aborts plugin signals and in-flight plugin resolvers/streams, removes only plugin-owned handlers, unsubscribes listeners, and runs cleanup in reverse order. It leaves the caller's session, unrelated overrides, and consumed `once` state intact. Cleanup continues after individual failures and reports an `AggregateError`.

Disposal waits for setup already in progress so its returned disposer can run. Asynchronous setup must honor `context.signal`; a setup promise that never settles can prevent disposal from completing. This SDK is a lifecycle extension mechanism for trusted code, not a sandbox. Register extensions before starting concurrent test traffic to avoid requests observing partial initialization.
