# Vite 项目集成 Mokup（完整示例版）

本文档面向 Vite 项目，提供从 0 到 1 的 Mokup 集成方式，并通过大量示例展示文件路由、handler、参数解析、响应控制等完整用法。

## 环境要求

- Node.js `>=22.12.0`

## 升级提示

- 已发布包现在只提供 ESM 构建，不再支持 CommonJS `require()`。
- 内部构建链已经切到 `tsdown + rolldown`。
- 共享构建辅助入口统一使用 `@mokup/shared/rolldown`。
- 如果你是在升级已有项目，先看 [v1 迁移指南](./migration-v1.md)。

## 快速开始

### 安装

```bash
pnpm add mokup -D
```

### Vite 配置

```ts
import mokup from 'mokup/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    mokup({
      entries: {
        dir: ['mock', 'mock-extra'],
        prefix: '/api',
        exclude: [/mock\/_ignored/],
        ignorePrefix: '.',
        watch: true,
        log: true,
      },
    }),
  ],
})
```

### 目录结构示例

```txt
mock/
  users/
    index.get.json
    me.get.json
    [id].get.ts
  reports/
    [...slug].get.ts
  docs/
    [[...slug]].get.ts
  login.post.ts
  search.get.ts
  override.get.ts
  health.get.ts
  about.get.jsonc
  _ignored/
    excluded.get.ts
mock-extra/
  batch/
    one.get.ts
    two.post.ts
  status/
    accepted.get.ts
  override/
    target.get.ts
  delay.get.ts
  binary.get.ts
```

## 文件路由规则（UVR 风格）

### 方法后缀（必填）

文件名必须包含 HTTP 方法后缀：`.get/.post/.put/.patch/.delete/.options/.head`
示例：`mock/users/me.get.json` -> `GET /users/me`

### index 归并

`mock/users/index.get.json` -> `GET /users`
`mock/api/index/index.get.ts` -> `GET /api/index`

### 动态参数

`mock/users/[id].get.ts` -> `GET /users/:id`
`c.req.param('id')` 为字符串。

### Catch-all 与可选 Catch-all

`mock/reports/[...slug].get.ts` -> `/reports/*`，`c.req.param('slug')` 为字符串（用 `/` 分割）。
`mock/docs/[[...slug]].get.ts` -> `/docs` 或 `/docs/a/b`，缺省时数组为空。

### 路由优先级

静态 > 动态 > catch-all，路径越具体优先级越高。

### 路由分组

不支持 `(group)`，出现会被跳过并告警。

### 忽略文件/目录

默认忽略以 `.` 开头的目录或文件名（可用 `ignorePrefix` 改成 `_` 或其他前缀）。
示例：

- `mock/api/.draft.get.json` -> 忽略
- `mock/api/.temp/users.get.ts` -> 忽略整棵目录

目录级也可在 `index.config.ts` 中覆盖 `ignorePrefix`，并通过 `include/exclude` 精准控制。

## Mock 文件类型

### JSON / JSONC

`mock/about.get.jsonc`

```jsonc
{
  // JSONC 支持注释与尾逗号
  "version": "0.1.0",
  "mission": "Mock APIs at lightspeed"
}
```

`.json` 文件也按 JSONC 解析，因此同样支持注释与尾逗号。

### TS/JS 模块

支持导出对象、数组、函数。规则字段使用 `handler`，`response` 不再支持。
函数式响应建议显式声明 `RequestHandler`（或使用 `defineHandler` 获取类型提示）。

## Handler 约定（强烈推荐）

函数响应必须明确类型，避免 `c` 隐式 `any`：

```ts
import type { RequestHandler, RouteRule } from 'mokup'

const handler: RequestHandler = (c) => {
  c.header('x-mokup', 'ok')
  return { ok: true }
}

const rule: RouteRule = {
  handler,
}

export default rule
```

Tip：你也可以用 `defineHandler` 包裹导出，获得更好的智能提示：

```ts
import { defineHandler } from 'mokup'

export default defineHandler((c) => {
  c.header('x-mokup', 'ok')
  return { ok: true }
})
```

## 基础路由示例（完整 handler）

### 静态路由

`mock/health.get.ts`

```ts
import type { RouteRule } from 'mokup'

const rule: RouteRule = {
  handler: 'OK',
}

export default rule
```

### 动态参数

`mock/users/[id].get.ts`

```ts
import type { RequestHandler, RouteRule } from 'mokup'

const handler: RequestHandler = (c) => {
  const id = c.req.param('id')
  return {
    ok: true,
    id,
    params: c.req.param(),
  }
}

const rule: RouteRule = {
  handler,
}

export default rule
```

### Catch-all

`mock/reports/[...slug].get.ts`

```ts
import type { RequestHandler, RouteRule } from 'mokup'

const handler: RequestHandler = (c) => {
  const slugValue = c.req.param('slug')
  const slug = slugValue ? slugValue.split('/') : []
  return {
    ok: true,
    slug,
    trail: slug.join('/'),
  }
}

const rule: RouteRule = {
  handler,
}

export default rule
```

### 可选 Catch-all

`mock/docs/[[...slug]].get.ts`

```ts
import type { RequestHandler, RouteRule } from 'mokup'

const handler: RequestHandler = (c) => {
  const slugValue = c.req.param('slug')
  const slug = slugValue ? slugValue.split('/') : []
  return {
    ok: true,
    slug,
    empty: slug.length === 0,
  }
}

const rule: RouteRule = {
  handler,
}

export default rule
```

## 行为示例（响应控制）

### 延迟与 Header

`mock/search.get.ts`

```ts
import type { RequestHandler, RouteRule } from 'mokup'

const handler: RequestHandler = async (c) => {
  await new Promise(resolve => setTimeout(resolve, 220))
  const term = c.req.query('q')
  c.header('x-mokup-query', String(term ?? ''))
  const pageText = c.req.query('page')
  return {
    term: term ?? 'none',
    page: Number(pageText ?? 1),
    results: [
      { id: 1, label: `${term ?? 'signal'}-alpha` },
      { id: 2, label: `${term ?? 'signal'}-beta` },
    ],
  }
}

const rule: RouteRule = {
  handler,
}

export default rule
```

### 状态码与鉴权

`mock/login.post.ts`

```ts
import type { RequestHandler, RouteRule } from 'mokup'

const handler: RequestHandler = async (c) => {
  await new Promise(resolve => setTimeout(resolve, 150))
  const payload = await c.req.json().catch(() => ({})) as {
    username?: string
    password?: string
  }
  const body = payload && typeof payload === 'object' ? payload : {}
  if (body.username === 'mokup' && body.password === '123456') {
    return {
      ok: true,
      message: 'Access granted. Welcome to the mock channel.',
      token: 'mock-token-7d91',
    }
  }
  c.status(401)
  return {
    ok: false,
    message: 'Invalid credentials.',
    hint: 'Try mokup / 123456',
  }
}

const rule: RouteRule = {
  handler,
}

export default rule
```

### 二进制响应

```ts
import type { RouteRule } from 'mokup'

const rule: RouteRule = {
  handler: new Uint8Array([1, 2, 3, 4]),
}

export default rule
```

### 数组导出（可选）

支持导出数组，但每条规则仍使用文件路由，重复路由会告警：

```ts
import type { RouteRule } from 'mokup'

const rules: RouteRule[] = [
  { handler: { ok: true, step: 'one' } },
  { handler: { ok: true, step: 'two' } },
]

export default rules
```

## 请求对象字段说明

`RequestHandler` 的参数如下：

```ts
import type { Context } from 'hono'

type RequestHandler = (context: Context) => Response | Promise<Response> | unknown
```

`Context` 字段重点：

- `c.req.param()` / `c.req.param('id')`
- `c.req.query()` / `c.req.query('q')`
- `await c.req.json()` 读取 body（JSON）

`c.status()`/`c.header()` 用于设置状态码与头部，延迟可用 `await new Promise(...)` 或规则 `delay`。

## 高级配置

### 多目录扫描

```ts
mokup({
  entries: {
    dir: ['mock', 'mock-extra'],
  },
})
```

### prefix

```ts
mokup({
  entries: {
    prefix: '/api',
  },
})
```

### 多目录不同前缀

```ts
mokup({
  entries: [
    { dir: 'mock', prefix: '/api' },
    { dir: 'mock-extra', prefix: '/api-extra' },
  ],
})
```

### include/exclude

```ts
mokup({
  entries: {
    include: [/mock/],
    exclude: [/mock\/_ignored/],
  },
})
```

### 关闭 watch/log

```ts
mokup({
  entries: {
    watch: false,
    log: false,
  },
})
```

### Playground 路由

默认会挂载 `/__mokup` 作为 mock 调试入口：

```ts
mokup({
  entries: {
    dir: 'mock',
  },
  playground: true,
})
```

自定义路径或关闭：

```ts
mokup({
  entries: {
    dir: 'mock',
  },
  playground: {
    path: '/__mokup',
    enabled: true,
  },
})

mokup({
  entries: {
    dir: 'mock',
  },
  playground: false,
})
```

Playground 会请求 `/__mokup/routes` 获取当前扫描到的 mock 列表，UI 由 Vue 3 + Tailwind CSS 4 构建。

## 常见问题

### 没有方法后缀？

`.json/.jsonc` 会默认当作 `GET`，其他文件会被跳过并告警。请确保文件名类似 `users.get.ts`。

### 路由冲突？

相同 `method + url` 会告警，实际匹配顺序不建议依赖冲突项。

### `req` 报 TS7006？

函数响应请显式声明 `RequestHandler`，或使用 `defineHandler`，不要直接写 `(c) => ...`。

## 应用层中间层（useRequest）

在应用侧可以封装一个 `useRequest` 中间层，根据 mock 开关选择 mock 或真实接口。

### 编译时变量

```ini
# .env
VITE_USE_MOCK=true
VITE_API_BASE=https://api.example.com
```

### 全局开关 + 单次覆写

```ts
import { getUseMock, setUseMock, useRequest } from '@/api'

setUseMock(false)
console.log(getUseMock())

await useRequest({
  method: 'GET',
  url: '/users',
})

await useRequest({
  method: 'GET',
  url: '/users',
  mock: true,
})
```

`useRequest` 会根据 `mock` 参数或全局开关选择 `baseURL`：

- mock：`import.meta.env.BASE_URL ?? '/'`
- real：`import.meta.env.VITE_API_BASE ?? '/api'`
