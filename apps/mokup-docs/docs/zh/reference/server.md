# Server 适配器

`mokup/server/node` 提供 Node 适配器与开发服务器。Worker 请使用 `mokup/server/worker`，运行时无关的 fetch 入口请使用 `mokup/server/fetch`。

## Fetch 入口（Node）

使用场景：

- 从本地 mock 目录快速启动独立的 mock 服务。
- 在 Node 进程中嵌入一个 fetch 风格的 mock 服务。

示例：

```ts
import { createFetchServer, serve } from 'mokup/server/node'

const app = await createFetchServer({
  entries: { dir: 'mock' },
  playground: false,
})
serve({ fetch: app.fetch, port: 3000 })
```

可以直接调用 `app.fetch`：

使用场景：

- 在测试或服务内部逻辑中直接请求 mock 服务。

示例：

```ts
const response = await app.fetch(new Request('http://localhost/api/users'))
```

调用 `await app.refresh()` 可以手动重新加载 mock 文件。刷新会串行执行，扫描期间收到的刷新请求会合并到下一次扫描。新快照构建成功后，路由表、请求处理器和 playground 元数据会一起更新；刷新失败时仍保留上一份可用快照。

入口的重新加载行为和已导入辅助模块的刷新限制见[原生模块刷新](../advanced/hot-reload.md#原生模块刷新)。

开启文件监听时，`await app.close?.()` 会停止 watcher、取消尚未开始的后台刷新，并等待正在执行的扫描结束。此后仍可显式调用 `app.refresh()`。关闭监听端口时，还需要单独关闭 `serve()` 返回的 HTTP server。

## 选项

使用场景：

- 在受限运行时中传入 `moduleMap`/`moduleBase`。
- 使用 `onNotFound: 'response'` 让 handler 直接返回 404。

```ts
export interface ServerOptions {
  manifest: Manifest | (() => Promise<Manifest>)
  moduleBase?: string | URL
  moduleMap?: Record<string, Record<string, unknown>>
  onNotFound?: 'next' | 'response'
}
```

`onNotFound` 默认是 `'next'`，设为 `'response'` 会直接返回 404。

适配器会先匹配请求方法与路径，命中后才读取请求体。Mokup 不会消耗未匹配请求的请求体：下游中间件仍可读取 Node 请求流，原本未读取的 Fetch `Request` 也会保持 `bodyUsed === false`。设置 `onNotFound: 'response'` 时同样如此。

自定义适配器可以先调用 [`runtime.hasRoute({ method, path })`](./runtime.md#读取请求体前查询路由)，命中后再解析请求体并调用 `runtime.handle`。

Node 适配器接受路径形式的请求目标和完整的 HTTP(S) URL。格式错误的 URL，以及 `ftp:`、`ws:`、`file:` 等其他协议，会在加载路由或读取请求体前产生 `400` 错误。Connect 和 Express 将错误传给 `next(error)`；Koa 和 Fastify 交由框架的错误处理器处理。开发环境的 mock 与 Playground 中间件也会拒绝这些请求目标。开头的双斜杠仍作为路径的一部分。

Hono 适配器可在 Hono 支持的运行时中使用，Cloudflare Worker 请使用专用入口。

示例：

```ts
import type { ServerOptions } from 'mokup/server'
import mokupBundle from './.mokup/mokup.bundle.mjs'

const options: ServerOptions = {
  manifest: mokupBundle.manifest,
  moduleMap: mokupBundle.moduleMap,
  moduleBase: mokupBundle.moduleBase,
  onNotFound: 'response',
}
```

## 准备 manifest

可直接加载 CLI 生成的 bundle：

::: code-group

```bash [pnpm]
pnpm exec mokup build --dir mock --out .mokup
```

```bash [npm]
npm exec mokup build --dir mock --out .mokup
```

```bash [yarn]
yarn mokup build --dir mock --out .mokup
```

```bash [bun]
bunx mokup build --dir mock --out .mokup
```

:::

```ts
import mokupBundle from './.mokup/mokup.bundle.mjs'

const options = {
  manifest: mokupBundle.manifest,
  moduleMap: mokupBundle.moduleMap,
  moduleBase: mokupBundle.moduleBase,
}
```

上面的 `options` 可直接传给任意适配器，下方示例为简洁起见直接传 `manifest`。

## 响应 Cookie

适配器会保留 handler 返回的 `Response` 中每一条独立的 `Set-Cookie`，包括 `Expires` 日期里的逗号。Node/Express 响应使用 `appendHeader`，Koa 使用 `append`；Fastify、Fetch、Hono 和 Worker 适配器也会保留完整列表。

自定义 Node 响应对象若只实现 `setHeader(name, string)`，或自定义 Koa context 只实现 `set(Record<string, string>)`，则保持原有标量行为，只输出最后一条 Cookie。要保留全部 Cookie，请补充可选的 `appendHeader(name, string)` 或 `append(name, string)` 方法；已有必选方法的签名无需修改。

## Express

使用场景：

- 在现有 Express 服务中挂载 mock 路由。

示例：

```ts
import { createExpressMiddleware } from 'mokup/server/node'

app.use(createExpressMiddleware({ manifest }))
```

## Connect

使用场景：

- 兼容 Connect/legacy middleware 栈。

示例：

```ts
import { createConnectMiddleware } from 'mokup/server/node'

app.use(createConnectMiddleware({ manifest }))
```

## Koa

使用场景：

- 给 Koa 服务注入 mock 路由。

示例：

```ts
import { createKoaMiddleware } from 'mokup/server/node'

app.use(createKoaMiddleware({ manifest }))
```

## Hono

使用场景：

- 在 Hono App 中插入 Mokup mock 路由。

示例：

```ts
import { createHonoMiddleware } from 'mokup/server/node'

app.use(createHonoMiddleware({ manifest }))
```

## Fastify

使用场景：

- 通过 Fastify 插件方式接入 Mokup。

示例：

```ts
import { createFastifyPlugin } from 'mokup/server/node'

await app.register(createFastifyPlugin({ manifest }))
```

## Fetch / Worker

使用场景：

- 运行时无关的 fetch 处理（Worker、边缘运行时或自定义服务）。
- 与你自己的路由系统组合使用。

示例：

```ts
import { createFetchHandler } from 'mokup/server/fetch'

const handler = createFetchHandler({ manifest })
const response = await handler(new Request('https://example.com/api'))
```

## Worker 入口

Worker 环境（含 Cloudflare Workers）请使用 helper 入口，它基于
`mokup/server/fetch` 的 `createFetchHandler` 封装，并在 handler 返回 `null`
时统一输出 404：

使用场景：

- 以最小入口文件部署到 Cloudflare Workers。
- 自动处理 `null` 结果的 404 响应。

示例：

```ts
import { createMokupWorker } from 'mokup/server/worker'
import mokupBundle from 'virtual:mokup-bundle'

export default createMokupWorker(mokupBundle)
```
