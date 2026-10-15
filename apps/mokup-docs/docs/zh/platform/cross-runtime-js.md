# 跨运行时 JavaScript 指南

用一份代码同时运行在 Service Worker、Cloudflare Worker 与 Node.js 的关键是：
核心逻辑只依赖 Web 标准 API，把运行时差异放在很薄的适配层里。

## 目标与边界

目标是构建一个通用的请求处理器：

- 使用 `Request`/`Response`/`URL`/`Headers`
- 不直接访问文件系统
- 环境变量可选（有就用，没有也能跑）
- 运行时特性集中在适配层

本指南不绑定任何框架，只提供可移植的最小模板。

## 运行时差异速览

Service Worker：

- 无文件系统
- 通过 `fetch` 事件驱动
- 浏览器内可用 `caches`

Cloudflare Worker：

- 无文件系统
- 支持模块或 Service Worker 语法
- 绑定通过 `env` 注入

Node.js（>=22.12.0）：

- 支持 `fetch`/`Request`/`Response`
- 有文件系统，但跨平台逻辑中尽量避免
- 环境变量通过 `process.env`

## 兼容性清单

- 使用 `globalThis` 与 Web API（`fetch`、`Request`、`Response`、`Headers`、`URL`）。
- 避免在共享逻辑里使用 `Buffer`/`fs`，用 `ArrayBuffer`/`Uint8Array` 替代。
- 明确处理 JSON/文本（`response.json()`、`response.text()`）。
- `env` 作为可选输入，做能力检测。
- 不依赖 `window`/`document`/DOM。
- 避免 Node 专属全局（`__dirname`、`process`），必要时做 guard。
- 模块使用 ESM，兼容 Worker 运行时。

## 最小跨平台处理器

```ts
export type RuntimeEnv = Record<string, string | undefined>

export async function handleRequest(
  request: Request,
  env?: RuntimeEnv,
): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/health') {
    return new Response('ok')
  }
  const apiBase = env?.API_BASE ?? 'https://example.com'
  const upstream = new URL(url.pathname, apiBase)
  const response = await fetch(upstream.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' ? undefined : request.body,
  })
  return response
}
```

## Service Worker 适配层

```ts
import { handleRequest } from './shared'

globalThis.addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request))
})
```

## Cloudflare Worker 适配层

```ts
import { handleRequest } from './shared'

export default {
  fetch(request: Request, env: Record<string, string>) {
    return handleRequest(request, env)
  },
}
```

## Node.js 适配层（>=22.12.0）

```ts
import { createServer } from 'node:http'
import { handleRequest } from './shared'

const server = createServer(async (req, res) => {
  const request = new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
  })
  const response = await handleRequest(request, process.env)
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(await response.text())
})

server.listen(3000)
```

## 常见坑

- 直接把 Node 的 `IncomingMessage` 当成 `Request` 使用。
- 在 Worker 里读取 `process.env`。
- 共享逻辑中使用 `Buffer`。
- 依赖 `window` 或 DOM API 处理 URL/存储。
