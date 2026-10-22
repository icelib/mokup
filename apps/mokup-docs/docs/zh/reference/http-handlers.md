# HTTP Handler 与会话

从 `mokup/http` 导入 HTTP 定义。同一份定义可用于 `setupServer`、`setupWorker`，也可交给 `createMockSession` 直接处理请求。

```ts
import { createMockSession, http, HttpResponse } from 'mokup/http'

const session = createMockSession(
  http.get('/users/:id', ({ params }) => HttpResponse.json({ id: params.id })),
)

try {
  const response = await session.handle(new Request('https://api.example.test/users/42'))
  console.log(await response?.json())
}
finally {
  await session.dispose()
}
```

`session.handle()` 返回 Fetch `Response`；请求应交给真实网络时返回 `undefined`。直接会话不会代为发起网络请求。返回 `passthrough()` 会立即停止匹配；返回 `undefined` 则继续尝试后续 Handler。

## 请求与响应类型

HTTP 工厂支持 `<Params, RequestBody, ResponseBody>` 类型参数。Params 可以使用接口，重复参数可以声明为 `string[]`。这些类型描述契约，不会在运行时校验传入的 JSON；需要运行时检查时应使用契约校验。

```ts
import { http, HttpResponse } from 'mokup/http'

interface Params { id: string }
interface Input { name: string }
interface Output { id: string, name: string }

export const updateUser = http.put<Params, Input, Output>(
  '/users/:id',
  async ({ params, request }) => {
    const body = await request.json() // Input
    return HttpResponse.json<Output>({ id: params.id, name: body.name })
  },
)
```

显式指定响应类型时，应返回带类型的 `HttpResponse`。省略类型参数时仍支持原生 `Response`。`HttpResponse.json<T>().json()` 的返回类型为 `Promise<T>`。

## 原生文件 Handler

在路由文件中使用 `defineHttpHandler`，即可通过标准 Fetch 对象处理请求。文件名提供方法和路径，例如 `mock/users/[id].post.ts`：

```ts
import { defineHttpHandler } from 'mokup'
import { HttpResponse } from 'mokup/http'

export default defineHttpHandler<{ id: string }, { name: string }, { id: string, name: string }>(
  async ({ request, params }) => {
    const body = await request.json()
    return HttpResponse.json({ id: params.id, name: body.name })
  },
  { once: true, headers: { 'x-mock': 'native' } },
)
```

Resolver 同时收到 cookies、requestId、传输上下文和 `finalize`，支持与 `http.get/post/...` 相同的生成器、`undefined`、`passthrough()` 和 `networkError()`。原有 `defineHandler` 文件继续使用 Hono Context 和原有响应值规范化。

文件可以导出混合原生与 Hono 规则的数组。每条规则分别持有 once 和序列状态；消耗一条规则后，会执行真正选中的下一条规则及其中间件和响应覆盖。目录 Hono 中间件在每次请求、每个序列步骤都会执行。仅修改响应头不会把原生的未响应变成 Mock；提前返回或原生后置中间件显式提供的响应则会生效。中间件和原生 resolver 可以独立读取上传请求体。

Vite、Webpack、CLI 构建和部署运行时会在 manifest 中保留 `handlerType: 'http'`、`once` 和模块规则索引。生成器保留为可执行模块，构建时不会推进序列；`--no-handlers` 会省略原生 resolver。`createRuntimeApp()` 通过 `mockSession` 提供与文件开发服务器相同的控制 API，应用关闭时应销毁该会话。

## 响应序列

同步或异步生成器可以逐次提供响应。迭代器状态属于会话：同一定义用于另一个会话，或调用 `session.fork()`，都会得到独立序列。

```ts
import { delay, http, HttpResponse } from 'mokup/http'

export const job = http.get('/job', async function* ({ request, finalize }) {
  finalize(() => releaseJobResources())
  yield HttpResponse.json({ state: 'pending' })
  await delay(50, { signal: request.signal })
  return HttpResponse.json({ state: 'complete' })
})

function releaseJobResources() {
  // 释放这个序列持有的资源。
}
```

- 每次匹配推进一步，并发请求的迭代步骤按顺序执行。
- 生成器的上下文来自首次调用，后续请求不会替换其中的 request、params 和 cookies。需要每次请求的新上下文时，应使用普通 resolver。
- `yield undefined` 让当前请求继续匹配后续 Handler。最终 `return` 的响应只交付一次；序列结束后继续匹配后续 Handler，不会重复播放最后一次响应。
- `{ once: true }` 在首次返回非 `undefined` 结果后消耗 Handler；该响应的资源释放后，迭代器随之关闭。
- `restoreHandlers()` 恢复 once 定义，保留普通序列的进度，并允许之前的响应继续完成。`resetHandlers()` 重启序列并恢复初始定义；传入新定义时改为使用新定义。
- 移除 Handler、重置或销毁会话时，通过 `.return()` 关闭迭代器。`dispose()` 会等待异步清理。异步生成器需要响应 `request.signal` 或自行结束等待，清理才能完成。

普通 resolver 的 `finalize()` 在响应流完成、取消或请求/会话中止时执行。生成器的回调属于迭代器生命周期；自然结束时，会等待所有 yield 和 return 的响应体结束后再清理。显式关闭迭代器会中止其工作并释放资源。普通 resolver 可并发执行，序列的推进保持串行。

## Cookie 与传输上下文

Resolver 通过 `cookies` 读取 Cookie。Node 请求读取 `Cookie` 请求头；浏览器禁止构造合成的 `Cookie` 请求头，因此传输层可通过会话上下文传递：

```ts
await session.handle(request, { cookies: { token: 'from-transport' } })
```

会话会复制这份数据。同名 Cookie 以显式请求头为准。直接会话不保存 Cookie jar；浏览器传输层的所有权及清理方式见[网络 Mock](../advanced/network-mocking)。

浏览器 Mock 的响应 Cookie 应使用 `HttpResponse`。即使浏览器从响应头中过滤 `Set-Cookie`，它也会保留元数据：

```ts
return HttpResponse.json({ authenticated: true }, {
  headers: [
    ['Set-Cookie', 'session=demo; Path=/; SameSite=Lax'],
    ['Set-Cookie', 'theme=dark; Path=/'],
  ],
})
```

自定义传输层可以通过 `getResponseCookies(response)` 读取元数据，重建响应时使用 `copyResponseCookies(source, target, overrideHeaders?)` 保留它；显式 `Set-Cookie` 覆盖具有优先级。元数据可以经过 `HttpResponse.clone()`、会话流处理、HEAD 规范化和编译后的 manifest 响应。普通原生 `Response` 中已经被过滤的 Cookie 无法恢复，JavaScript 也不能读取真实 HttpOnly Cookie。
