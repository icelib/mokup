# WebSocket mock

`mokup/ws` 拦截通过全局标准 `WebSocket` 构造器创建的连接。它使用独立于 HTTP 的控制器。

```ts
import { setupWebSocket, ws } from 'mokup/ws'

const chat = ws.link('wss://example.test/chat')
chat.addEventListener('connection', ({ client, signal }) => {
  client.addEventListener('message', (event) => {
    client.send(`echo:${String(event.data)}`)
  })
  signal.addEventListener('abort', () => {
    // 清理为这个连接创建的定时器或其他资源。
  }, { once: true })
})

const sockets = setupWebSocket(chat)
sockets.start({ onUnhandledConnection: 'error' })

// 运行应用中创建 WebSocket 连接的代码。
// 在测试清理或离开应用预览时等待 stop()。
await sockets.stop()
```

## 匹配与客户端

按照传给 `setupWebSocket` 的顺序匹配 link。第一个命中的 link 接管连接，即使它没有注册 connection 监听器。

- 完整 `ws:` 或 `wss:` URL 匹配规范化后的完整地址，包括查询字符串。
- 以 `/` 开头的字符串精确匹配路径和查询字符串，不限制主机。
- `'*'` 匹配所有 WebSocket 地址。
- 正则表达式匹配完整 URL；不同连接之间不会共享 `lastIndex`。

`link.clients` 返回当前客户端的快照。`link.broadcast(data)` 向所有当前客户端发送文本或二进制消息；使用 `{ except: [client] }` 排除特定客户端。集合只属于当前 JavaScript 环境，不会跨浏览器标签页或进程同步。

`client.send(data)` 向应用发送消息，`client.close(code?, reason?)` 关闭连接。客户端的 `message` 监听器收到应用发出的消息，`close` 监听器观察关闭。`addEventListener('connection', listener)` 返回移除此连接监听器的函数。

## 连接真实服务

默认连接由 mock 处理。调用 `server.connect()` 才会连接原始地址；连接后自动转发应用消息和服务端响应。通过 `event.preventDefault()` 可以替换或阻止任一方向的转发。

```ts
chat.addEventListener('connection', ({ client, server }) => {
  server.connect()
  client.addEventListener('message', (event) => {
    event.preventDefault()
    server.send(`modified:${String(event.data)}`)
  })
  server.addEventListener('message', (event) => {
    event.preventDefault()
    client.send(`upstream:${String(event.data)}`)
  })
})
```

`server.send(data)` 要求先调用 `server.connect()`，上游尚未打开时会排队发送。`server.close()` 仅关闭上游连接。服务端支持 `open`、`message`、`error`、`close` 事件。

## GraphQL subscription

`mokup/graphql` 的 `createGraphQLWebSocket` 会创建使用 `graphql-transport-ws` 协议的 `ws.link`。它确认 `connection_init`，接收带操作名称的 `subscribe`，发送连续的 `next`，并在每个操作结束时发送 `complete`。返回的 link 与其他 WebSocket Mock 使用同一个控制器启动。

```ts
import { createGraphQLWebSocket } from 'mokup/graphql'
import { setupWebSocket } from 'mokup/ws'

const graphql = createGraphQLWebSocket('/graphql', {
  async* Count() {
    yield { count: 1 }
    yield { count: 2 }
  },
})
const controller = setupWebSocket(graphql)
controller.start({ onUnhandledConnection: 'error' })
```

`setupWebSocket` 暴露与 HTTP session 相同的事件形状。通过
`start({ events: session.events })` 传入已有事件总线，可以把
`protocol:start`、`protocol:match`、`protocol:message`、`protocol:unhandled`、
`protocol:end` 和 `protocol:error` 合并到同一个诊断流：

```ts
const session = createMockSession()
const diagnostics = createDiagnosticsCollector(session)
const sockets = setupWebSocket(graphql)
sockets.start({ events: session.events })
// diagnostics.snapshot().timeline 现在会包含 WebSocket 连接元数据。
```

Resolver 会收到包含解析后 query、操作名称、variables、请求 ID 和可取消请求 signal 的标准 Mokup 请求上下文。HTTP/SSE 客户端可以改用 `graphql.link('/graphql').subscription(...)`。

## 生命周期与支持范围

重复调用 `start()` 不会重复安装。每个 JavaScript 环境只允许一个活动的 Mokup WebSocket 控制器，启动第二个会抛出错误，并保留当前控制器。HTTP 控制器可以同时运行。`stop()` 会中止连接的 signal、移除连接消息监听器、发起所属 mock 和上游连接的关闭、清空客户端集合，并恢复原始全局构造器。再次调用 `start()` 可建立新连接，link 定义与 connection 监听器仍可复用。

`onUnhandled` 独立于 HTTP 策略。默认 `bypass` 连接原始服务；`warn` 还会打印警告；`error` 在连接打开前以 `1008` 状态码关闭连接。传入函数时会收到共享协议事件和 `{ signal, connection }`，函数返回后仍按默认 bypass 流程处理；函数抛错会发出 `protocol:error` 并关闭连接。`onUnhandledConnection` 作为弃用兼容别名保留。

```ts
const controller = setupWebSocket(chat)
controller.start({
  onUnhandled(event, { connection, signal }) {
    console.warn(`没有匹配的 Mock：${event.url}`)
    // 回调可以检查连接，也可以自行连接原始服务。
    if (!signal.aborted) {
      connection.server.connect()
    }
  },
})
```

应用收到的 `open` 事件由拦截器控制。转发连接可能在上游握手完成前显示为打开，mock 子协议从客户端请求的协议中选择。此控制器不能用于验证真实握手时序、子协议协商、TLS、压缩、帧分片或服务端 WebSocket upgrade。

普通 WebSocket 连接会为每个线上消息发出 `protocol:message`，其中
`direction: 'inbound'` 表示应用发往 Mock，`direction: 'outbound'` 表示 Mock 或上游发往应用。GraphQL 会在这些传输事件之上追加操作级协议事件。

拥有可替换全局 WebSocket 的浏览器和 Node.js 可直接使用。在 Node.js 20 中，需要先将兼容实现（例如 `undici`）设置到 `globalThis.WebSocket`，否则 `start()` 会抛出包含接入提示的错误。`import WebSocket from 'ws'` 等独立导入的构造器不会被拦截，除非在应用代码运行前将其安装为全局构造器。`start()` 之前创建的连接以及其他 JavaScript 环境中的连接不受影响。

集成测试使用 Node 的全局 WebSocket，覆盖文本和二进制 mock、真实本地 WebSocket 服务转发、双向消息改写、严格未命中策略、匹配优先级、广播、取消、停止与重启。Chrome、Firefox 和 WebKit 浏览器 conformance 已覆盖匹配消息、广播、未命中 error 策略、生命周期事件和 teardown；握手时序与子协议协商仍不在该矩阵内。
