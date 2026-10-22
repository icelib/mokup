# 可选集成

Mokup runtime 不依赖控制面板或 AI 工具。集成层只消费稳定的快照和契约，
因此可以逐步接入，不需要改写已有 Mock handler。

## Devframe

`createDevframeBridge` 通过结构化 host 接口暴露诊断、handler 覆盖率和场景控制：

```ts
import { createDevframeBridge } from 'mokup/devframe'

const bridge = createDevframeBridge(server.mockSession)
const disconnect = bridge.connect({
  send: message => panel.postMessage(message),
  onCommand: listener => panel.onMessage(listener),
})

disconnect()
bridge.dispose()
```

连接时发送带版本号的快照，请求时间线只发送轻量事件通知；执行
`scenario.select`、`scenario.reset`、`diagnostics.clear` 后会发送新快照。
请求和响应正文不应由面板回传 runtime。

如果已经创建插件宿主，可以传入 `{ plugins }`，在 `snapshot.resources` 中显示可发现的
资源元数据：

```ts
const bridge = createDevframeBridge(server.mockSession, { plugins })
```

面板只能看到资源的 `kind`、`name` 和插件名称，资源值始终保留在插件宿主内。

## MCP 与 AI 生成

`createMokupMcpServer` 实现与传输无关的 MCP JSON-RPC：`initialize`、
`tools/list`、`tools/call`。宿主可以通过 stdio、HTTP 或 Devframe 暴露它，
浏览器和 Worker bundle 不会增加 MCP 依赖。

Fetch 兼容的 HTTP 宿主可以直接使用内置适配器。它会将 JSON-RPC notification
返回为 `202`，保留标准 JSON-RPC 错误响应，并处理 `OPTIONS` 预检。合法的
JSON-RPC 信封（包括 JSON-RPC 错误）返回 `200`，JSON 解析失败或信封无效返回 `400`：

```ts
import { createMcpHttpHandler, createMokupMcpServer } from 'mokup/mcp'

const mcp = createMcpHttpHandler(createMokupMcpServer(), { cors: true })
export default { fetch: mcp }
```

Node CLI 宿主可以通过独立的 Node 入口使用换行分隔 JSON 的 stdio 适配器。默认
读取 `process.stdin` 并写入 `process.stdout`，也可以注入流用于测试或嵌入：

```ts
import { createMokupMcpServer } from 'mokup/mcp'
import { createMcpStdioServer } from 'mokup/mcp/stdio'

await createMcpStdioServer(createMokupMcpServer()).start()
```

工具输出都需要人工审查：

- `mokup.inspect` 列出规范化后的 operation 和响应状态；
- `mokup.generate` 返回 TypeScript handler、fixture、operation 元数据以及
  `requiresHumanReview: true`；
- `mokup.validate` 返回每个 fixture 的请求和响应问题，失败时标记 MCP tool error。

生成结果中的 `structuredContent` 带有版本号，面板无需解析源码文本即可渲染。
`mokup.generate` 返回 `{ schemaVersion: 1, source, fixtures, operations, review }`；
其中 `review` 包含 `operationCount`、`fixtureCount` 和
`requiresHumanReview: true`。将返回的 `fixtures` 传给 `mokup.validate`，再接受生成的
契约。校验结果返回 `{ schemaVersion: 1, valid, fixtures }`，每个 fixture 都包含
`request.parameters`、`request.body` 和带有 `valid`、`issues` 的 `response` 报告。
这样路径、query、header、cookie 参数及请求体都会出现在审查 UI 中：

```ts
import type { McpGenerateStructuredContent, McpValidationStructuredContent } from 'mokup/mcp'

const generated = await server.callTool('mokup.generate', { contract })
const generatedContent = generated.structuredContent as McpGenerateStructuredContent
const fixtures = generatedContent.fixtures
const report = await server.callTool('mokup.validate', { contract, fixtures })
const validation = report.structuredContent as McpValidationStructuredContent
if (validation.valid !== true) {
  throw new Error('发布前请先审查生成的 fixture。')
}
```

CLI 负责文件和网络加载，CI 中可以用 `mokup generate --allow-network` 明确授权。

## 部署模板与 Mock 包共享

Node、Deno、Bun、Cloudflare Workers、Vercel、Netlify 的可运行模板位于
[`examples/deploy`](https://github.com/icelib/mokup/tree/main/examples/deploy)。
它们统一使用 `createFetchHandler` 或 `createMokupWorker`，替换成
`mokup` 生成的 bundle 时无需改变平台入口。

团队共享沿用 Git tag 或 npm 包。生成的 bundle、manifest、handler 依赖和
Mokup 版本一起固定；发布前执行 `mokup check --contract` 与 packed consumer
smoke test。
