# 网络 Mock、场景与录制回放

Mokup 支持两种互补的编写方式：文件路由用于开发服务器和可部署的 manifest；HTTP handler 用于测试与浏览器页面中的请求拦截。HTTP 边界使用原生 Fetch Request 和 Response。

## 五分钟跑通 Node

安装 Mokup，把下面的代码保存为 `mock-demo.mjs`：

```sh
pnpm add -D mokup
```

```js
import { http, HttpResponse } from 'mokup/http'
import { setupServer } from 'mokup/node'

const server = setupServer(
  http.get('https://api.example.com/users/:id', ({ params }) =>
    HttpResponse.json({ id: params.id, name: 'Ada' })),
)

server.listen({ onUnhandled: 'error' })
try {
  const response = await fetch('https://api.example.com/users/1')
  console.log(await response.json())
}
finally {
  await server.close()
}
```

执行 `node mock-demo.mjs`。普通 `fetch` 会收到 Mock 响应，无需监听端口或替换业务请求客户端。Node 入口支持 Fetch、Node ClientRequest 和可用的 XMLHttpRequest；单独配置的 Undici 客户端等其他传输方式不在自动覆盖范围内。

## 测试生命周期与临时覆盖

```ts
import { http, HttpResponse } from 'mokup/http'
import { setupServer } from 'mokup/node'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'

const server = setupServer(
  http.get('https://api.example.com/users', () => HttpResponse.json([])),
)

beforeAll(() => server.listen({ onUnhandled: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

it('处理临时服务错误', async () => {
  server.use(http.get('https://api.example.com/users', () =>
    HttpResponse.json({ error: 'unavailable' }, { status: 503 }), { once: true }))
  expect((await fetch('https://api.example.com/users')).status).toBe(503)
  expect((await fetch('https://api.example.com/users')).status).toBe(200)
})
```

`use` 把临时规则放到匹配队列最前面；`resetHandlers()` 恢复初始规则；`restoreHandlers()` 重新启用已消费的一次性规则。收尾时等待关闭操作。Node 的 `server.boundary(callback)` 为回调内的异步工作隔离规则覆盖和一次性消费状态，但不会复制用户模块的全局变量或 scenario 对象。

返回 `passthrough()` 可停止继续匹配，让原请求访问真实网络；`networkError()` 模拟没有 HTTP 响应的传输错误。`delay(milliseconds, { signal: request.signal })` 支持取消。未匹配请求默认 `bypass`，隔离测试建议设置 `error`，开发环境可用 `warn`。原生 `onUnhandled` 回调接收请求元数据，不提供可消费的请求体。

字符串规则使用 MSW 3 同样采用的 `@msw/url`，支持命名参数、可选参数 `:id?`、多段参数 `:path*`/`:path+` 和域名/路径通配符。同名参数重复出现时返回数组；匿名通配符使用数字键，同时保留最后一个通配符的 Mokup `params['*']` 别名。字符串和 RegExp 匹配忽略 query 与 hash，自定义 predicate 仍能读取原始 URL。Node 相对规则可匹配任意 origin；浏览器相对规则根据当前页面解析，跨源规则应使用绝对 URL 或开头的通配符。`http.get` 只匹配 GET，HEAD 需显式声明 `http.head`。

## 文件服务器、Vite 与 Webpack 会话

`createFetchServer` 的原生 handler 与文件规则使用同一个会话。初始原生规则优先于文件规则；刷新文件时保留临时覆盖和已消费的 `once` 状态，`resetHandlers()` 恢复最新文件版本：

```ts
import { http, HttpResponse } from 'mokup/http'
import { createFetchServer } from 'mokup/server'

const server = await createFetchServer({
  entries: { dir: 'mock', watch: false },
  handlers: [http.get('/extra', () => HttpResponse.json({ native: true }))],
  onUnhandled: 'warn',
})
server.mockSession.events.on('request:start', event => console.log(event.requestId, event.url))
server.mockSession.use(http.get('/users', () => HttpResponse.json([]), { once: true }))
try {
  const response = await server.fetch(new Request('http://localhost/extra'))
  console.log(await response.json())
  await server.refresh()
  server.mockSession.resetHandlers()
}
finally {
  await server.dispose()
}
```

`dispose()` 永久关闭会话、取消活动流并停止监听，重复调用返回同一个 Promise。兼容性的 `close()` 仅停止文件监听；需要完整收尾时使用 `dispose()`。Playground 的内部请求不计入 Mock 请求事件。

程序化创建 Vite 时，可在配置完成后读取当前服务器代次的会话：

```ts
import { http, HttpResponse } from 'mokup/http'
import mokup from 'mokup/vite'
import { createServer } from 'vite'

const plugin = mokup({ entries: { dir: 'mock' } })
const vite = await createServer({ plugins: [plugin] })
const session = plugin.api.getMockSession()
session.use(http.get('/api/users', () => HttpResponse.json([]), { once: true }))
await vite.listen()
// 测试或集成收尾：await vite.close()。
```

成功的热更新保留订阅和临时覆盖，失败的扫描或签名计算保留整个旧快照。替换文件规则不会取消已经进入旧规则的响应。服务器关闭时会取消未结束的流；Vite 重启后的新服务器有独立会话，需重新读取会话并订阅。

原生规则支持额外路径，也支持空 Mock 目录。两个插件都接受顶层 `handlers` 与 `onUnhandled`。Vite 当前要求使用默认的 `runtime: 'node'`。策略作用于所有到达 Mock 中间件的请求，包括未匹配的静态资源；可通过回调仅对 API 路径执行严格策略。Connect 在分发前复制非 GET/HEAD 上传体，旁路时保留原始字节供后续中间件读取，Mock 响应则以背压传输。上传体目前会缓冲。

Webpack 按 compiler 和 watch 代次维护会话：

```ts
import { http, HttpResponse } from 'mokup/http'
import { createWebpackPlugin } from 'mokup/webpack'

export const plugin = createWebpackPlugin({
  entries: { dir: 'mock' },
  handlers: [http.get('/extra', () => HttpResponse.json({ native: true }))],
  onUnhandled: 'bypass',
})

export default { plugins: [plugin], devServer: {} }
```

compiler 启动后，通过 `plugin.api.getMockSession(compiler)` 读取控制接口与订阅。同一个插件用于多个配置时，必须显式传入对应 compiler。bundle 构建失败保留旧 HTTP 基线；刷新保留临时覆盖和 once 消费状态。`watchClose` 取消活动响应并关闭旧会话；仍挂载的 middleware 在暂停期间用新状态提供最后一份文件快照。compiler shutdown 也会关闭快照会话，重新 watch 获得独立会话并重新读取文件。

## 部署 middleware 与 Worker 会话

Manifest 适配器接受初始 `handlers` 和 `onUnhandled` 配置。Fetch、Hono、Worker、Connect、Express、Koa 与 Fastify 返回的 handler/plugin 均提供 `ready`、`use`、`resetHandlers`、`restoreHandlers`、`listHandlers`、`setOnUnhandled`、`events`、`signal` 和 `close`：

```ts
import { http, HttpResponse } from 'mokup/http'
import { createFetchHandler } from 'mokup/server/fetch'

const handler = createFetchHandler({
  manifest: { version: 1, routes: [] },
  handlers: [http.get('/health', () => HttpResponse.json({ ok: true }))],
  onUnhandled: 'warn',
})
handler.use(http.get('/users', () => HttpResponse.json([]), { once: true }))
try {
  await handler(new Request('https://preview.example.test/users'))
  handler.restoreHandlers()
}
finally {
  await handler.close()
}
```

`ready()` 惰性加载 manifest，并返回共享 session。可以先订阅事件和设置覆盖。`close()` 永久关闭适配器、释放活动流，并取消正在等待 manifest 的请求；Fastify 也会随应用关闭 session。普通异步 resolver 从首次调用起就可并发执行；generator 的推进步骤在每个 session 内串行执行。

Fetch 适配器保留输入 Request 的 body，即使 predicate/resolver 读取副本后返回 `passthrough()` 也能继续交给下游。原生 Node middleware 缓冲可回放的上传副本，并按背压发送响应。如果前置框架 middleware 已消费上传，则使用其解析后的 body。旧的最小结构化请求/响应接口保留缓冲兼容路径。

Worker `fetch(request, env, executionCtx)` 与 Hono middleware 将每个请求的 bindings 和 execution context 传给文件 handler；原生 resolver 通过 `context` 获取它们。传递原 execution context，确保 bindings 和 `waitUntil` 属于当前请求。`onNotFound` 决定 bypass 后的下游/404 行为，`onUnhandled` 管理实际未命中请求。Worker helper 始终返回 Response，最终兜底为 404。

将 Hono middleware 安装到子应用再挂载。相对 HTTP matcher 和文件路径按挂载作用域匹配，resolver 的 Request 与生命周期事件保留完整原始 URL。Hono 兼容 handler 保留父级参数与变量；同一个子应用多次挂载时仍共享控制接口：

```ts
import { Hono } from 'hono'
import { createHonoMiddleware } from 'mokup/server/node'

const middleware = createHonoMiddleware({ manifest: { version: 1, routes: [] } })
const child = new Hono().basePath('/api')
child.use('*', middleware)
const app = new Hono().route('/teams/:tenant', child)
middleware.use(http.get('/health', ({ request }) => HttpResponse.text(request.url)))
// GET /teams/team/api/health 返回完整原始 URL。
```

编译后的 manifest 代次持有路由、中间件和响应元数据的副本，包括静态 JSON body。初始化后修改调用方的 manifest 不会改变延迟加载时的行为；通过新建 runtime 或刷新文件服务器发布新代次。

## 浏览器启动

```ts
import { setupWorker } from 'mokup/browser'
import { http, HttpResponse } from 'mokup/http'

const worker = setupWorker(
  http.get('/api/users', () => HttpResponse.json([{ id: 1, name: 'Ada' }])),
)
await worker.start({ onUnhandled: 'warn', serviceWorker: { url: '/mockServiceWorker.js' } })
// 拦截启动后再启动应用。
// 测试或页面集成销毁时调用 await worker.stop()。
```

默认启动会在安全浏览器上下文注册 Mokup 的 Service Worker。首次运行开发服务器前，先复制资产：

```js
// scripts/copy-mock-worker.mjs
import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
await mkdir('public', { recursive: true })
await copyFile(require.resolve('mokup/mockServiceWorker.js'), 'public/mockServiceWorker.js')
```

运行 `node scripts/copy-mock-worker.mjs`，升级 Mokup 后重新生成。这是 Mokup 自己的脚本与协议，不能使用 MSW 的同名文件。同 scope 已存在其他 Service Worker 时，启动会拒绝覆盖。`await worker.stop()` 断开本会话，不卸载已有 registration。

无法使用 Service Worker 时，显式选择 `start({ mode: 'interceptor' })`。该降级模式只拦截页面 Fetch/XHR，不覆盖导航、子资源、独立 Worker 或其他标签页。文件路由也可继续使用已有的 [Vite SW 模式](../reference/vite-plugin#service-worker-模式)。

### 浏览器 Cookie

两种浏览器模式都为每个活动 Mock 实例维护独立的虚拟 Cookie jar。通过 `HttpResponse` 设置 Cookie，可在浏览器 `Response` 构造器过滤 Set-Cookie 之前保留其内容：

```ts
const worker = setupWorker(
  http.post('/login', () => HttpResponse.json({ ok: true }, {
    headers: { 'Set-Cookie': 'session=demo; Path=/; HttpOnly; SameSite=Lax' },
  })),
  http.get('/session', ({ cookies }) => HttpResponse.json({ session: cookies.session })),
)
```

虚拟 jar 遵循 host/Domain、Path、过期时间/Max-Age、Secure、SameSite 与请求 credentials。`credentials: 'omit'` 禁止读取和保存 Cookie；跨源请求需要 `include`，跨站 Cookie 还需 `SameSite=None; Secure`。未声明 SameSite 时默认为 Lax。虚拟 HttpOnly 值可通过 resolver 的 `cookies` 读取，`worker.stop()` 会清空 jar。

当前 `document.cookie` 中可见的值仅用于同源请求。浏览器不暴露这些值的 Path/Domain 属性或真实 HttpOnly Cookie，因此无法重建。虚拟值仅作为 resolver 元数据，不写入浏览器 Cookie、不修改 `document.cookie`、不跨重启持久化，也不为真实透传请求添加 Cookie header。浏览器原生 `new Response` 已过滤 Set-Cookie；设置虚拟 Cookie 时请使用 `HttpResponse` 构造器或其 helper。

## 从 MSW 迁移 HTTP 导入

```ts
import { http, HttpResponse } from '@mokup/msw'
import { setupServer } from '@mokup/msw/node'

const server = setupServer(
  http.get('https://api.example.com/users', () => HttpResponse.json([])),
)
server.listen({ onUnhandledFrame: 'error' })
// 在测试收尾中等待 server.close()。
```

通过 `pnpm add -D @mokup/msw` 安装，把规则定义里的 `msw`、`msw/node`、`msw/browser` 导入改为对应的 `@mokup/msw` 路径，再重新创建 handler。这是 HTTP 迁移层；对暴露标准 `kind`、`info` 和 resolver 结构的 MSW 3 HTTP handler 对象也会自动适配。

MSW 3 的 HTTP 导入 `msw/http` 改为 `@mokup/msw`。`onUnhandledFrame` 字符串策略作用于 HTTP 请求，默认 `warn`；MSW 2 的 `onUnhandledRequest` 仍作为字符串别名保留，冲突的别名会报错。兼容层中的生成器耗尽、抛出的 `Response`、普通 `once` 和 once 生成器行为遵循 MSW 3.0.2；原生 `mokup/http` handler 仍保留 Mokup 的有限序列语义。

| 能力                                                | 支持范围                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| HTTP 方法和 `{ once: true }`                        | 支持，使用 Mokup 的匹配语义                                                      |
| 原生 `Request`、`Response`、`HttpResponse` helper   | 支持 params/请求体/响应体泛型与 `HttpResponse<T>`，不保证完整的 MSW 类型别名兼容 |
| `use/resetHandlers/restoreHandlers/listHandlers`    | 支持                                                                             |
| `onUnhandledFrame`、`onUnhandledRequest`            | MSW 3 字符串策略及 MSW 2 别名映射到原生 `onUnhandled`，默认 `warn`               |
| `setupWorker`                                       | 默认使用 Mokup Service Worker，可显式降级为页面 Fetch/XHR                        |
| MSW HTTP 对象、回调策略、`quiet`、未记录的 MSW 选项 | HTTP 对象和回调策略支持；未知启动选项及其他协议对象会明确报错                    |
| MSW 的 GraphQL/WebSocket 导入和事件载荷             | 不在兼容范围内                                                                   |

## 可复现的场景与 CRUD 数据

```ts
import { createMemoryStore, createScenario } from 'mokup/scenario'

const scenario = createScenario('checkout-42', { authenticated: true })
const users = createMemoryStore([{ id: '1', name: 'Ada' }], 'id')

scenario.update((state) => {
  state.authenticated = false
})
const status = scenario.choose({ success: 200, unavailable: 503 }, 'unavailable')
const nextId = scenario.integer(2, 1000)
users.create({ id: String(nextId), name: 'Grace' })
users.update('1', { name: 'Ada Lovelace' })

const checkpoint = scenario.snapshot()
scenario.random()
scenario.restore(checkpoint) // 同时恢复状态与随机数生成器的位置。
scenario.reset() // 恢复初始状态与种子序列。
users.reset() // store 有独立的重置边界。
```

需要命名变体或并行测试时，可以把场景复制到 catalog 中：

```ts
import { createScenario, createScenarioCatalog } from 'mokup/scenario'

const scenarios = createScenarioCatalog({
  happy: createScenario('checkout', { authenticated: true, latency: 0 }),
  unavailable: createScenario('checkout-error', { authenticated: true, latency: 0, status: 503 }),
})
scenarios.compose('slow-unavailable', 'unavailable', 'happy')
scenarios.select('slow-unavailable').update((state) => {
  state.latency = 500
})
const isolated = scenarios.fork() // 可在另一个测试或用户会话中独立修改。
```

场景状态和记录必须支持 `structuredClone`。读写、快照均使用副本，不同实例不共享状态。`update` 必须同步执行，只有执行成功才提交。catalog 会复制输入场景，`compose` 按层顺序合并对象状态，`fork` 会复制所有命名状态，适合隔离测试或用户会话。当前不提供持久化或自动会话识别。`pick(array)` 和不指定名称的 `choose(variants)` 使用种子随机数；指定名称不会推进随机序列。

## 录制、脱敏、回放与 HAR

```ts
import { http } from 'mokup/http'
import { createReplay, exportHar, importHar, recordInteraction } from 'mokup/recording'

const request = new Request('https://api.example.com/users?token=secret')
const response = await fetch(request.clone())
const fixture = await recordInteraction(request, response, {
  maxBodyBytes: 1024 * 1024,
  bodyTimeoutMs: 5000,
  redact: { query: ['token'], jsonPointers: ['/password', '/user/accessToken'] },
})

const har = exportHar([fixture])
const replay = createReplay(importHar(har))
const handler = http.all('*', ({ request }) => replay.handle(request))
// 把 handler 传给 setupServer 或 setupWorker。
```

录制读取克隆，不消费原 Request/Response。每个 body 默认限制 1 MiB 和 5 秒，JSON 脱敏前后均检查大小。超限、未结束、已消费或被锁定的 body 会明确失败。请求取消会同时中止请求体或响应体的录制。无限流不能录制；流式 Mock 使用 `mokup/sse`。

Authorization、Proxy-Authorization、Cookie、Set-Cookie 始终脱敏，其他 header、查询参数和 JSON Pointer 路径可配置。URL 用户名、密码和片段会移除。JSON Pointer 仅作用于 JSON 内容类型；启用 JSON 脱敏时，非法 JSON 会被拒绝。任意文本和二进制内容会原样保存，不会自动扫描秘密字段，因此保存前应配置业务敏感字段。脱敏后的 Cookie 不能重现认证凭据。

回放匹配 HTTP 方法、完整规范化 URL，以及经过 fixture 脱敏规则处理后的精确 body 字节。fixture 按数组顺序消费，默认 `times: 1`，未匹配返回 `undefined`。各回放实例计数独立；`reset()` 恢复计数并使在途工作失效，`remaining()` 返回剩余次数。`replayTiming: true` 会应用记录的 `durationMs`。回放移除 content length、transfer encoding 和 content encoding，因为录制内容是 Fetch 提供的已解码字节。

HAR 响应二进制使用标准的 `content.encoding: 'base64'`。HAR 1.2 没有标准的二进制请求体编码，Mokup 使用 `postData._encoding: 'base64'` 和保存次数、脱敏信息的 `_mokup` 扩展。普通文本 HAR 可直接导入；不支持的编码和未捕获 body 会报错，不生成不完整 fixture。Mokup 导出再导入可保留二进制 fixture 和次数，其他 HAR 工具可能忽略这些扩展。

## 透传录制与 fixture 差异比较

代码需要显式请求真实 API 时，可以使用 `createRecordingFetch` 包装传入的请求函数。它不会启动监听服务或替换全局 Fetch：

```ts
import { createRecordingFetch } from 'mokup/recording'

const recorder = createRecordingFetch(fetch, {
  maxEntries: 100,
  maxInFlight: 8,
  redact: { query: ['token'], jsonPointers: ['/token', '/password'] },
})
const response = await recorder.fetch('http://127.0.0.1:3000/api/users')
const users = await response.json()
await recorder.flush()
const fixtures = recorder.fixtures()
const issues = recorder.errors()
// 保存 fixture 或认定采集完整之前，先检查 issues。
recorder.clear()
```

透传函数接收原生 `Request`；传入 Request 且没有覆盖选项时，直接传递该对象。上游响应头到达后立即返回原 Response，包括 429 等错误 HTTP 状态。请求体和响应体的克隆在后台录制，沿用每个 body 1 MiB/5 秒的限制。`durationMs` 表示等待响应头的时间，不包含完整下载耗时。透传函数自身的错误会原样返回调用方。

只保存完整且成功脱敏的 fixture。录制失败会放弃当前采集，真实请求继续正常透传。`errors()` 仅包含请求序号和固定的 code/stage，不保留上游错误消息、URL、header 或 body；该历史最多保留 `maxEntries` 条。默认敏感 header 仍会脱敏，查询参数和 JSON 秘密字段需按前文配置。

`maxEntries` 限制已保存 fixture 与预留槽位总数，`maxInFlight` 限制并行采集数，包括等待上游响应头的采集。达到限制时只跳过本次录制，仍会发出请求，不对 API 限流。`fixtures()` 按请求调用顺序返回副本；`flush()` 等待当前已注册的采集。`clear()` 删除已存数据并取消在途采集，不取消已转发的请求。上游等待时间由调用者的请求取消信号控制。包装器支持标准 Request/RequestInit，不转发 Undici dispatcher 等客户端专属选项。

使用纯函数 `diffRecordedInteractions` 比较已保存与新录制的交互：

```ts
import type { RecordedFixture } from 'mokup/recording'
import { diffRecordedInteractions } from 'mokup/recording'

function compare(expected: RecordedFixture, actual: RecordedFixture) {
  return diffRecordedInteractions(expected, actual, {
    redact: { headers: ['date', 'x-request-id'], jsonPointers: ['/updatedAt'] },
    maxDifferences: 100,
  })
}
```

结果为 `{ equal, differences, truncated }`。每项差异包含 JSON Pointer 路径、`added`/`removed`/`changed` 类型，以及脱敏后的预期值/实际值。JSON body 按结构比较，忽略对象键顺序，路径形如 `/response/body/value/id`；非 JSON body 比较精确字节，以 base64 表达。缺失 body 与空 body 保持区别。

比较前合并双方 fixture 与额外配置中的脱敏规则，始终保留默认敏感 header 掩码。可通过 `headers`、`query`、`jsonPointers` 掩盖动态值，但字段是否存在仍参与比较。录制时间/耗时、回放次数、content length/encoding/transfer framing 不参与比较；其他请求/响应头、完整规范化 URL、方法、状态码与状态文本仍参与比较。每个 body 默认最多解码 1 MiB；非法 JSON 或不支持的 fixture 版本会明确失败。该函数不发起网络请求，也不修改输入。自动发现流量、定时差异检查和外部持久化仍由调用方负责。

需要立即比较 Mock 与真实 API 时可以使用 `compareLive`。它为两侧各创建一个请求副本，只读取有上限的响应副本，并返回脱敏后的请求、两侧错误、fixture 差异以及可选的 OpenAPI 响应校验：

```ts
import { compareLive } from 'mokup/recording'

const result = await compareLive(request, {
  mock: input => mockSession.handle(input),
  real: input => fetch(`https://api.example.com${new URL(input.url).pathname}`, input),
}, { contract: operation, redact: { query: ['token'] } })

if (!result.equal) {
  console.log(result.diff?.differences, result.contract?.differences)
}
```

Mock 侧返回 `undefined` 会被标记为 bypass；任一侧抛出的错误只保留错误文本。原始 Request 和两侧返回的 Response 仍可继续使用，因为比较器只读取副本。无限 body、已锁定 body 或超过限制的 body 会明确导致该侧比较失败。

即时比较忽略响应 `Date`、逐跳连接头（包括 `Connection` 指定的字段）和 HTTP 状态文本，避免传输层自动添加的元数据产生误报。状态码、应用响应头和正文仍参与比较。返回的 fixture 保留原始传输元数据；`diffRecordedInteractions` 继续按其更严格的规则比较已保存的 fixture。

## OpenAPI 契约与类型化 handler

```ts
import { createContract, generateFixture } from 'mokup/contract'

const schema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
  additionalProperties: false,
}
const contract = createContract(schema)
const value = generateFixture(schema)
contract.parse(value) // 失败时抛出包含路径和问题说明的 ContractError。
```

`importOpenApi`、`generateOpenApiFixtures`、`validateOpenApiResponse` 支持本地 OpenAPI 3.0/3.1 的 JSON 契约。CLI 读取 JSON 文档，可以生成已验证的 fixture 或 TypeScript 模块：

```sh
pnpm exec mokup generate --contract openapi.json --out fixtures.json
pnpm exec mokup check --contract openapi.json --fixtures fixtures.json --json
pnpm exec mokup generate --contract openapi.json --format typescript --out mocks.generated.ts
```

生成命令拒绝覆盖已有输出。TypeScript 模块导出每个操作的请求/响应 body 类型、`operations`、`fixtures` 和 `createHandlers(resolvers)`。Resolver 以规范化的 HTTP 方法与路径为键，例如 `POST /users/:id`。编程调用使用 `generateContractSource(document)`。

`createContractHandler(operation, resolver)` 把导入的操作接入原生 HTTP handler。Resolver 除普通请求上下文外，还接收解析后的 `body`，返回 `{ status, body?, headers? }`。桥接层先验证 JSON 请求体，非法输入返回明确的 4xx；响应按声明的状态码与内容类型校验最终序列化的 JSON，非法 Mock 输出抛出 `ContractError`。请求体读取默认限制为 1 MiB 和 5 秒，序列化响应使用相同的大小限制，可通过 `maxBodyBytes`、`bodyTimeoutMs` 配置；该超时不限制 resolver 执行时间。空响应契约及 204/205/304 会生成真正没有 body 的响应。

`createContractCrudHandlers(operations, store)` 会为 `GET` 集合/单项、
`POST`、`PUT`、`PATCH` 和 `DELETE` 生成经过 contract 校验的 handler。
`store` 只需要实现 `list/get/create/update/delete`，因此可以从
`createMemoryStore` 替换成数据库或插件资源，而不用改 OpenAPI operation。
路径参数声明为字符串时会保留字符串 ID；需要可重复的创建结果时传入
`idFactory`。

导入的操作还会在读取 body 前验证 query、header、path、cookie 参数。解析结果单独放在 `context.parameters.query/header/path/cookie`，原始 `request`、`params` 与 `cookies` 保持原样。`parameters.header` 的键统一小写。生成的请求/响应类型描述 body；参数使用共享的标量、数组和扁平对象值类型。

| 位置   | 支持的序列化                                                                    |
| ------ | ------------------------------------------------------------------------------- |
| Query  | `form`；标量、默认 `explode: true` 的重复键数组，或 `explode: false` 的逗号数组 |
| Header | `simple`；标量或逗号数组，名称匹配不区分大小写                                  |
| Path   | `simple`；标量或逗号数组，参数必须占据完整的命名路径段                          |
| Cookie | `form`；标量，或显式 `explode: false` 的逗号数组                                |

Schema 必须显式声明 `string`、`number`、`integer`、`boolean` 或对应标量数组，也可通过有限的本地 schema 引用声明。布尔值接受 `true`/`false`，数值使用有限的十进制表示，整数必须在 JavaScript 安全整数范围内。解码后继续验证 enum、范围、pattern、format 和数组 item 等 JSON Schema 约束。存在原始 query/path/Cookie header 时，百分号编码的逗号会保留在数组项内容中；由传输层补充且没有原始 header 的 Cookie 已被解码，无法保留这一差别。

必填参数缺失时返回 400，即使 schema 有 default 也不会补值。默认值只用于缺失的可选参数，初始化时验证，每个请求独立克隆。查询空字符串需要 `allowEmptyValue: true` 且符合 schema，不会替换为默认值；标量 query 重复键会被拒绝。错误路径形如 `/parameters/query/page`，不回显请求值。同位置/名称的操作级参数覆盖 path-item 参数。按 OpenAPI 规则，`Accept`、`Content-Type`、`Authorization` 的 header 参数定义会忽略；安全规则通过 `security` 与 `securitySchemes` 声明。参数解码由 `createContractHandler` 执行；JSON fixture 生成/检查不会生成或发出带参数的 HTTP 请求。

扁平对象参数以及 OpenAPI 的 `deepObject`、`label`、`matrix`、`spaceDelimited`、`pipeDelimited` 序列化样式会先解码再校验。未明确类型/nullable union 的序列化、参数 `content`、`allowReserved: true`、explode Cookie 数组及外部引用会明确失败。`createContractHandler` 已支持 API key、HTTP Basic/Bearer、OAuth 风格 bearer 安全规则和 multipart 请求契约；自动化真实 API 差异执行仍不在该 JSON 桥接层范围内。生成的 TypeScript 保守表达结构类型，不支持或递归的形状退化为 `unknown`。TypeScript 无法表达的约束继续由运行时验证；无法生成有效值的 fixture 会明确失败。

## GraphQL、SSE 与 WebSocket

`mokup/graphql` 提供基于操作名称的 handler，以及 HTTP query/mutation 的 schema 执行。`createGraphQLHandler` 支持以 `query.field` 或 `mutation.field` 为键的 `resolvers`，resolver 会收到解析后的参数和 Mokup 请求上下文，也可以通过 `persisted` 传入 APQ map。`createGraphQLPersistedOperations` 生成 APQ SHA-256 map，`graphql.persisted(...)` 支持只发送持久化 hash 的请求。`graphql.link('/graphql').subscription(...)` 通过 SSE 提供 subscription；`createGraphQLWebSocket`（也可通过 `graphql.websocket` 调用）实现 `graphql-transport-ws` 的连接、订阅、next、error、ping 和 complete 消息。`generateGraphQLSource(schema, { operations })` 会生成 SDL、对象/输入/枚举类型、根字段参数类型、resolver 声明、`createHandlers` 工厂以及运行时生成 APQ map 的异步 `createPersistedHandlers` 工厂。`mokup/sse` 提供支持取消清理的 `eventStream` 和 `sse` handler。Service Worker 模式下原生浏览器 `EventSource` 请求会经过 worker；interceptor 模式会安装可解析 Mock 流的 EventSource 兼容层，未命中时回退到原生构造器。

OpenAPI 契约命令 `mokup generate --contract api.yaml --out fixtures.json` 与 `mokup check --contract api.yaml --fixtures fixtures.json` 同时接受 JSON 和 YAML。相对路径的本地 `$ref` 会在校验和生成前解析。HTTP(S) 引用必须显式传入 `--allow-network`。runtime 契约包仍接收已经解析的对象，因此浏览器和 Worker bundle 不包含文件系统或 YAML loader。

`mokup/ws` 提供 `ws.link(...)`、连接监听、客户端快照、广播和可选的上游转发/改写。单独调用 `setupWebSocket(...links).start({ onUnhandledConnection: 'error' })` 启动，并在收尾时等待其 `stop()`。HTTP 的 `setupServer`/`setupWorker` 不会启动该控制器；每个 JavaScript realm 同时只能运行一个 WebSocket 控制器。它拦截全局 Web 标准构造器，全局构造器不可用时需要先提供兼容实现。不覆盖独立导入的构造器、其他 realm 和真实握手/TLS/压缩语义。详见 [WebSocket 参考](../reference/websocket)。

## 诊断、插件与 Playground 历史

`mokup/diagnostics` 的 `createDiagnosticsCollector(source)` 会记录有上限的 HTTP 和协议事件以及 handler 覆盖情况，包括从未执行的定义。HTTP 覆盖率传入 session；如果只需要 WebSocket、SSE 或 GraphQL 时间线，可以传 `{ events: controller.events }`。带版本的 `snapshot()`/`serialize()` 数据区分匹配与实际产出 Mock 响应，并保留协议未命中原因。请求 ID 可串联并发事件；完成响应解析不等于流已被消费，采集器始终不读取 body。

`mokup/plugin` 的 `createPluginHost(session)` 安装有独立作用域的 handler 和事件订阅。插件通过 `defer` 注册清理，并监听取消信号。安装失败会回滚；销毁会移除插件拥有的资源，并报告清理错误。这是面向可信代码的扩展机制。详见 [诊断与插件参考](../reference/extensions)。

Playground 提供请求历史、响应差异、handler 覆盖率统计以及 MSW/Playwright 响应导出，覆盖当前 Playground 界面发出的请求。导出保留方法/路径、状态码、MIME 类型和 body，省略查询参数与请求头；截断或失败的捕获不能导出。服务端诊断通过 Playground WebSocket 有界传输；覆盖率属于当前 HTTP session，不会自动收集应用的所有传输。

## Vitest/Jest hooks 与 Playwright 路由

Mokup 不导入或安装测试框架，显式传入项目使用的 hooks：

```ts
import { setupServer } from 'mokup/node'
import { registerMockHooks } from 'mokup/testing'
import { afterAll, afterEach, beforeAll } from 'vitest'

const server = setupServer()
registerMockHooks({ beforeAll, afterEach, afterAll }, {
  start: () => server.listen({ onUnhandled: 'error' }),
  reset: () => server.resetHandlers(),
  stop: () => server.close(),
})
```

Storybook 可以在 preview 中创建一个 decorator，并在 preview 收尾时保留并销毁 controller：

```ts
import { createStorybookDecorator } from 'mokup/testing'

const mocks = createStorybookDecorator({ handlers })
export const decorators = [mocks.decorator]
await mocks.ready
// 在 preview teardown 中调用 `await mocks.stop()`。
```

Cypress 可以在 `cy.intercept` 中复用同一 session：

```ts
import { createCypressInterceptor } from 'mokup/testing'

const mocks = createCypressInterceptor({ handlers })
cy.intercept('**/*', request => mocks.handle(request))
// 在 suite 的 after hook 中销毁 controller。
```

Jest 使用相同的 hook 签名。启动和关闭都会被等待，启动失败也会触发清理。只有明确需要测试间共享状态时，才在第三个参数设置 `resetAfterEach: false`。

Playwright 优先使用独立 context，并配置 `serviceWorkers: 'block'`，避免 Service Worker 先处理请求而使路由不可见：

```ts
import { http, HttpResponse } from 'mokup/http'
import { attachPlaywright } from 'mokup/testing'

const mocks = await attachPlaywright(context, {
  pattern: '**/api/**',
  handlers: [http.get('/api/users', () => HttpResponse.json([]))],
  onUnhandled: 'error',
})
try {
  // 使用 Playwright page 导航并操作应用。
}
finally {
  await mocks.detach()
}
```

BrowserContext 和 Page 均满足适配器的结构化接口，无需把 Playwright 作为运行时依赖。策略允许时，未匹配请求会交给后续路由。`detach` 只移除本适配器注册的回调并关闭本会话。处理失败会中止请求，写入 `errors()`，并使 `detach()` reject，防止收尾时悄悄吞掉失败。

Playwright fulfill 需要有限 body：默认请求和响应各限 1 MiB，响应限 5 秒，可通过 `maxBodyBytes` 和 `bodyTimeoutMs` 调整。请求体由 Playwright 预先缓冲。无限响应和多条 Set-Cookie 会被明确拒绝；这些场景应使用 Node/Service Worker 传输。本适配器不提供 WebSocket 路由。

## 通过 Git 或 npm 共享 Mock

直接把已有的 manifest 和打包 handler 作为版本化包共享，无需搭建 Mokup 专属 registry 服务。在独立的 `@team/api-mocks` 仓库中，把 `mock/` 纳入版本控制并执行：

```sh
pnpm exec mokup check --dir mock
pnpm exec mokup build --dir mock --out dist
pnpm pack
```

包应导出生成的 bundle，并包含完整输出，包括 `mokup-handlers`：

```json
{
  "name": "@team/api-mocks",
  "version": "1.0.0",
  "type": "module",
  "files": ["dist", "index.d.ts"],
  "exports": {
    ".": { "types": "./index.d.ts", "default": "./dist/mokup.bundle.mjs" }
  },
  "peerDependencies": { "mokup": "^3.1.0" }
}
```

TypeScript 消费方需要 `index.d.ts`：

```ts
import type { RuntimeOptions } from 'mokup/runtime'

declare const bundle: RuntimeOptions
export default bundle
```

发布到已有私有或公共 npm registry 前，在 CI 中验证打包产物。handler 导入的依赖需要在 Mock 包中声明。通过 Git 分发时，把生成的 `dist` 提交到发布 tag，消费方固定 tag 或 commit，不跟随可变分支。也可通过 workspace 或 tarball 安装相同产物。

仓库提供了一个可运行的 contract smoke test：它构建 handler 包、执行 `npm pack`，在隔离 consumer 中安装 tarball，导入两个公开入口，并通过 `createFetchHandler` 执行 bundle：

```sh
pnpm run test:mock-package-contract
```

消费方固定版本，例如 `pnpm add -D @team/api-mocks@1.0.0`，然后直接复用：

```ts
import bundle from '@team/api-mocks'
import { http } from 'mokup/http'
import { setupServer } from 'mokup/node'
import { createFetchHandler } from 'mokup/server/fetch'

const fetchMock = createFetchHandler(bundle)
const server = setupServer(http.all('*', async ({ request }) =>
  (await fetchMock(request)) ?? undefined))
```

同一个 bundle 也可交给已有的 Node/Worker 适配器。Git 共享源码、npm 共享构建产物都使用现有工具；托管 registry、团队控制台和自动部署仍属于后续工作。

## 交付矩阵

构建后的 manifest 和扫描得到的文件路由均编译到共享 HTTP 定义，Hono 作为兼容适配器。文件服务器、Vite、Webpack、部署 Fetch/Hono/Worker handler 与原生 Node middleware 均提供共享控制和事件，覆盖原生路径及未命中请求。成功刷新保留会话，失败候选保留已提供服务的 HTTP 基线，服务器或 compiler 代次关闭时销毁会话。Hono 嵌套路由经过动态父路径、上下文与控制接口测试；完整传输/边缘运行时验收矩阵仍待完成。

此表描述当前源码能力，包的可用版本以发布日志为准。

| 里程碑            | 已实现                                                                                                                                                                                                                                                                      | 尚待完成                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| M0：HTTP 测试基线 | 带类型的 HTTP handler、Node/Service Worker/页面拦截、生命周期/once/覆盖、`@msw/url` 匹配、按作用域隔离的浏览器虚拟 Cookie、HTTP 导入迁移层、测试框架 hooks 和 Playwright 路由                                                                                               | 完整 MSW API/对象/类型别名兼容、浏览器 Cookie 持久化、更广的传输/运行时验证 |
| M1：可复现 Mock   | 场景/CRUD、有限 body 录制/回放/HAR、透传录制、fixture 差异与 Mock/真实 API 即时比较、OpenAPI JSON/TypeScript 生成与检查、请求/响应/参数/安全/multipart 契约 handler、GraphQL HTTP/APQ、SSE subscription、graphql-transport-ws、浏览器 EventSource 支持、独立 WebSocket Mock | 自动会话持久化、定时差异检查流程                                            |
| M2：协作与诊断    | 文件路由/manifest、Git/npm 共享、部署适配器、HTTP 诊断与插件宿主、Playground 请求历史/响应差异/handler 覆盖率及框架适配器                                                                                                                                                   | 跨传输全局时间线、场景控件、自动部署、Devframe 集成                         |

M0 验收门禁仍待完成。Mokup 不宣称与 MSW 每个版本完全等价或全面领先。应依据文档支持范围，用项目自己的传输方式、测试和部署目标验证迁移结果。
