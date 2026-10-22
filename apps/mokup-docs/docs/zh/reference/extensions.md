# 诊断与插件

这些 API 操作 HTTP `MockSession` 或共享协议事件总线。使用 manifest runtime 时，通过 `await runtime.ready()` 获得 session。它们不会自动安装网络拦截或 WebSocket 控制器。

## 诊断

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

带版本号的快照包含 `timeline`、`handlers` 和 `totals`。时间线保留实际 HTTP 事件，包含序号、时间、请求 ID、方法、URL，以及相关 handler ID、状态码或错误元数据。通过 `requestId` 关联并发请求。`maxEntries` 限制保留的**事件数**而非请求数，因此某个请求的早期事件可能已被淘汰。

覆盖率区分 `matched` 与 `mocked`：匹配的 resolver 可以返回 `undefined`，继续尝试后续处理器。`active` 表示该定义当前是否仍已注册。未调用的定义显示零计数，移除的定义保留历史计数，直到 `clear()`。时间线淘汰不会重置累计总数。未命中事件会包含 `decisionChain`，按顺序记录方法和 matcher 的判定（`method-mismatch`、`once-exhausted`、`matcher-mismatch` 或 `matcher-error`），并在可用时提供可操作的细节。并发请求竞争 `once` 处理器时，只有在获胜请求消费处理器后，落败请求才会记录为 `once-exhausted`。

`snapshot()` 返回独立的数据副本。`serialize()` 输出 JSON，不包含处理器函数、请求或响应体、流对象或异常堆栈。URL 与错误消息会原样保留；若应用在其中放入敏感数据，对外提供诊断前需要自行脱敏。`clear()` 重置事件与计数。`dispose()` 仅移除该 collector 自己的监听器，并保留最后的快照。

`request:end` 表示响应解析阶段结束，不表示流式响应已被消费者完整读取。覆盖率统计已生成的 mock 响应，不代表流消费成功。协议适配器可以通过 session 事件总线发出统一的 `protocol:*` 生命周期记录；记录包含协议和连接元数据，保留未命中原因，不包含 body 内容。如果不需要 handler 覆盖率，可以传入 `{ events: controller.events }` 创建只收集协议事件的 collector。

## 场景与隔离 fork

当 handler 需要可复现状态或受控变体时，可以把命名场景目录绑定到 session。实现了 `fork()` 的场景目录会被 session 克隆，因此 `session.fork()` 可以独立选择场景而不修改父 session。

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

原生和文件 HTTP resolver 都可以从上下文读取 `scenario`。`selectScenario`、`resetScenario` 和 `session.scenario` 提供运行时控制；manifest runtime 可以在 `ready()` 前后调用 `runtime.selectScenario(...)`。

网络控制器创建时也可以绑定同一个 catalog。把 catalog 作为 `setupServer` 或
`setupWorker` 的最后一个 options 参数传入；控制操作会同时作用于持久定义和当前
传输会话。Service Worker 停止后再次启动时会保留当前选择。

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

## 插件宿主

```ts
import { http, HttpResponse } from 'mokup/http'
import { createPluginHost } from 'mokup/plugin'

const plugins = createPluginHost(session)
await plugins.use({
  name: 'health-check',
  setup({ use, defer, events, signal, registerResource, listResources }) {
    use(http.get('/health', () => HttpResponse.json({ ok: true })))
    registerResource({
      kind: 'data',
      name: 'health-fixture',
      value: { source: 'plugin' },
      dispose: () => {
        // 释放插件拥有的数据源。
      },
    })
    // 只返回资源元数据，不暴露 value。
    console.debug(listResources())
    const timer = setInterval(() => {
      if (signal.aborted) {
        clearInterval(timer)
      }
      // 维护插件自己的状态。
    }, 1000)
    defer(() => clearInterval(timer))
    events.on('request:unhandled', (event) => {
      // 读取 event.method 和 event.url，不消费请求体。
    })
    return () => {
      // 可选的其他同步或异步清理。
    }
  },
})

await plugins.dispose()
await session.dispose()
```

每个插件有非空且唯一的名称和带类型的 `setup(context)`。setup 可以返回清理函数，或异步返回该函数。`context.use` 安装插件拥有的 handler；`context.events.on` 跟踪事件订阅；`context.defer` 立即注册清理，即使 setup 随后失败也会执行。context 还提供 `signal`、`handle(request)`、`listHandlers()`、`registerResource(resource)` 和 `listResources()`。资源的 `kind` 可为 `protocol`、`data`、`storage` 或 `ui`；同一 host 中 `kind:name` 必须唯一。`registerResource` 返回异步注销函数，资源的 `dispose` 会在注销、回滚或宿主销毁时执行。资源值只保留在插件作用域，宿主和面板只能发现类型、名称和所属插件。

每次 `use(...)` 中的插件按顺序初始化。失败时倒序回滚本批次，保留此前成功安装的插件。名称会在异步初始化前预留，并发安装无法抢占相同名称。资源创建后应立即用 `defer` 登记清理；setup 尚未返回的清理函数无法被自动恢复。

`dispose()` 中止插件 signal 和在途 resolver/响应流，仅移除插件拥有的 handler，取消订阅，并倒序运行清理。调用方的 session、无关覆盖处理器以及已消费的 `once` 状态保持有效。单个清理失败后仍继续清理其他插件，并通过 `AggregateError` 报告失败。

销毁会等待正在执行的 setup，以运行它最后返回的清理函数。异步 setup 必须响应 `context.signal`；永不结束的 setup promise 会阻止销毁完成。此 SDK 是受信任代码的生命周期扩展接口，不是隔离沙箱。应在并发测试请求开始前安装插件，避免请求观察到尚未完成的初始化。
