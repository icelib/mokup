# 文件路由

Mokup 通过文件路径与文件名生成路由，核心规则如下：

## Method 后缀

文件名必须包含 HTTP 方法后缀（`.get`、`.post` 等）：

```
mock/users.get.json   -> GET /users
mock/users.post.ts    -> POST /users
```

在 Vite 插件中，`.json/.jsonc` 如果没有方法后缀，会默认视为 `GET`；在 CLI 构建时建议显式写方法后缀，避免歧义。

## 常见 REST 方法速览

常用 RESTful 路由与文件名的对应关系：

```
mock/items/index.get.ts       -> GET    /items
mock/items/index.post.ts      -> POST   /items
mock/items/[id].get.ts        -> GET    /items/:id
mock/items/[id].put.ts        -> PUT    /items/:id
mock/items/[id].patch.ts      -> PATCH  /items/:id
mock/items/[id].delete.ts     -> DELETE /items/:id
```

## index 路由

`index` 会被视为目录根路径：

```
mock/index.get.json       -> GET /
mock/users/index.get.ts   -> GET /users
```

## 动态参数

使用方括号定义参数：

```
mock/users/[id].get.ts    -> GET /users/:id
mock/[action]/[id].get.ts -> GET /:action/:id
```

在处理函数中可以通过 `c.req.param('id')` 访问：

参数名可以包含字母、数字、下划线和连字符，支持 `[123]`、`[user-id]` 等名称。调用 `c.req.param()` 时使用原始参数名。同名参数会产生警告，并使用最后一次出现的值。

静态段按字面匹配：`:fixed`、`*`、`ab{2}` 和 `a|b` 不会被解释为参数、通配符或正则表达式。文件名还需符合当前操作系统的限制。

```ts
export default {
  handler: c => ({ id: c.req.param('id') }),
}
```

提示：可以使用 `defineHandler` 包裹路由导出以获得更好的类型提示：

```ts
import { defineHandler } from 'mokup'

export default defineHandler({
  handler: c => ({ id: c.req.param('id') }),
})
```

也可以一次性返回所有参数：

```ts
import { defineHandler } from 'mokup'

export default defineHandler(c => ({
  params: c.req.param(),
}))
```

## Catch-all 与可选段

```
mock/docs/[...slug].get.ts   -> /docs/* (至少 1 段)
mock/docs/[[...slug]].get.ts -> /docs (可选)
```

这些规则与前端路由常见语法一致，适合做文档类 API 模拟。

`c.req.param('slug')` 返回以 `/` 连接的字符串；可选 Catch-all 缺席时返回 `undefined`，同时覆盖前面出现的同名参数。

## JSON 与 JSONC 路由

JSON 文件可以作为静态处理器：

```
mock/status.get.json  -> GET /status
```

JSONC 支持注释与尾随逗号：

```
mock/summary.get.jsonc -> GET /summary
```

动态参数同样适用于 JSON 路由：

```
mock/[action]/[id].get.json -> GET /:action/:id
```

## 多规则文件

一个文件可以导出规则数组。禁用的规则会被跳过，启用的规则会生效：

```ts
import type { RouteRule } from 'mokup'

const rules: RouteRule[] = [
  { enabled: false, handler: () => ({ variant: 'disabled' }) },
  { handler: () => ({ variant: 'active' }) },
]

export default rules
```

## 禁用路由

通过 `enabled: false` 直接禁用路由：

```ts
import { defineHandler } from 'mokup'

export default defineHandler({
  enabled: false,
  handler: () => ({ ok: false }),
})
```

## 目录配置（defineConfig）

在目录内放置 `index.config.ts`，可以配置延迟、响应头和中间件：

```ts
import { defineConfig, onAfterAll, onBeforeAll } from 'mokup'

export default defineConfig(({ app }) => {
  onBeforeAll(() => {
    app.use(async (c, next) => {
      c.header('x-mokup-pre', '1')
      await next()
    })
  })

  onAfterAll(() => {
    app.use(async (c, next) => {
      await next()
      c.header('x-mokup-post', '1')
    })
  })

  return {
    delay: 20,
    headers: { 'x-mokup-demo': 'file-routing' },
  }
})
```

## 忽略文件

不支持的扩展名（例如 `.txt`）会被忽略。默认会忽略以 `.` 开头的路径段：

```
mock/notes.txt            -> 忽略
mock/.draft/notes.get.ts  -> 默认忽略（.）
mock/.ignored/skip.get.ts -> 默认忽略（.）
```

你可以通过 `ignorePrefix`（字符串或数组）覆盖忽略列表。设置后会替换默认值，如果仍希望忽略以 `.` 开头的路径段，请保留 `.`：

```ts
// mock/index.config.ts
export default {
  ignorePrefix: ['.', 'draft-'],
}
```

```
mock/draft-legacy/skip.get.ts -> 当 ignorePrefix 包含 "draft-" 时忽略
```
