# Runtime API

`mokup/runtime` 是路由匹配与响应处理的核心。

## createRuntime

使用场景：

- 在自定义运行时或测试环境中直接调用 `runtime.handle`。
- 需要在非 Hono 环境中运行 mock（SSR、Worker、集成测试）。

示例：

```ts
import { createRuntime } from 'mokup/runtime'

const runtime = createRuntime({ manifest })
const result = await runtime.handle({
  method: 'GET',
  path: '/users',
  query: {},
  headers: {},
  body: undefined,
})
```

### 读取请求体前查询路由

`runtime.hasRoute({ method, path })` 返回 `Promise<boolean>`，与 `runtime.handle` 使用相同的路由匹配规则。`HEAD` 请求优先匹配显式 `HEAD` 路由，没有匹配时才回退到 `GET`。

这个查询不会执行处理器或中间件、导入处理器模块、应用延迟，也不会读取请求体。它会按需加载并缓存 manifest，因此首次调用可能执行 `RuntimeOptions` 中传入的 `manifest` 加载函数。

```ts
const matched = await runtime.hasRoute({ method: 'POST', path: '/users' })
```

自定义适配器可以先查询路由，再解析已匹配请求的请求体，让未匹配请求继续交给下游处理。命中后仍调用上方示例中的 `runtime.handle`，传入完整的标准化请求；`handle` 继续返回 mock 结果，未匹配时返回 `null`。

对于已匹配的请求，适配器可传入 `rawBodyBytes?: Uint8Array`，保留二进制请求体。运行时优先使用原始字节（包括空数组），其次使用 `rawBody?: string`，最后使用已解析的 `body`。构造 Fetch 请求前会复制所传视图中的字节，支持 Buffer 切片和 SharedArrayBuffer 视图。`GET` 与 `HEAD` 请求仍不携带请求体。

## 直接使用 CLI bundle

可直接加载 CLI 生成的 bundle：

使用场景：

- 在生产或受限运行时中复用预构建 bundle。
- 多个部署共享同一份构建产物。

示例：

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
import { createRuntime } from 'mokup/runtime'
import mokupBundle from './.mokup/mokup.bundle.mjs'

const runtime = createRuntime({
  manifest: mokupBundle.manifest,
  moduleMap: mokupBundle.moduleMap,
  moduleBase: mokupBundle.moduleBase,
})
```

如果没有打包函数处理器，可以省略 `moduleMap` 与 `moduleBase`。

## createRuntimeApp

根据 manifest 构建 Hono app（适用于 Service Worker 或自定义 fetch 处理）。

使用场景：

- 在 Worker / Service Worker 中使用 Hono 风格的 fetch 入口。
- 在任意支持 Hono 的运行时复用 Mokup 路由。

示例：

```ts
import { createRuntimeApp } from 'mokup/runtime'

const app = await createRuntimeApp({ manifest })
const response = await app.fetch(new Request('http://localhost/api/users'))
```

## Service Worker helper

`mokup/runtime` 也会导出 `hono/service-worker` 的 `handle`。

使用场景：

- 在 Service Worker 的 `fetch` 事件中挂载 Hono app。
- 用最少的胶水代码运行 Mokup。

示例：

```ts
import { createRuntimeApp, handle } from 'mokup/runtime'

const app = await createRuntimeApp({ manifest })
globalThis.addEventListener('fetch', handle(app))
```

## RuntimeOptions

使用场景：

- 延迟加载 manifest（按需读取或动态 import）。
- Worker 等无法直接 import 本地文件时传入 `moduleMap`/`moduleBase`。

```ts
export interface RuntimeOptions {
  manifest: Manifest | (() => Promise<Manifest>)
  moduleBase?: string | URL
  moduleMap?: Record<string, Record<string, unknown>>
}
```

`moduleMap` 用于 Worker 等无法动态 import 本地文件的场景，通常由 `mokup.bundle.mjs` 生成。

示例：

```ts
import type { RuntimeOptions } from 'mokup/runtime'
import mokupBundle from './.mokup/mokup.bundle.mjs'

const options: RuntimeOptions = {
  manifest: mokupBundle.manifest,
  moduleMap: mokupBundle.moduleMap,
  moduleBase: mokupBundle.moduleBase,
}
```
