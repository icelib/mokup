# Mokup：构建工具友好的可视化 Mock 工具（草稿）

![Mokup Logo](/brand/mokup-logo.svg)

大家好，我是 [icebreaker](https://github.com/sonofmagic)，一名前端开发者兼开源爱好者。

这里向大家介绍一下我最近在做的一个项目：Mokup，一个基于文件路由的 HTTP Mock 工具。

项目地址：[GitHub](https://github.com/icelib/mokup) , 官网与文档：http://mokup.icebreaker.top/

## Mokup 是什么

Mokup 是一个基于文件路由的 HTTP Mock 工具。你把 mock 文件放在 `mock/` 目录里，它会自动生成可匹配的路由并提供响应。

它的目标很直接：让 mock 在你已有的前端工程里尽快跑起来，减少“为了联调再造一套服务”的成本。

## 它的特性

- 构建工具友好：Vite / Webpack 都能接，不需要推翻现有工程。
- 可视化：内置 Playground，路由是否生效一眼可见。
- 开发体验好：mock 文件和目录配置改完就刷新，不用频繁重启。
- 能部署到多个环境：本地开发、Node 服务端、Worker、Service Worker 都可用。

## 为什么要做它

很多团队的痛点不是“不会写 mock”，而是：

- 接入步骤多，换个构建工具就要重配一次。
- 本地排查时看不到全局路由状态，只能翻文件猜。
- 每改一个 mock 都要重启或手动验证，反馈慢。

Mokup 就是为了解决这三个问题：接入更轻、可视化更强、开发反馈更快。

## 构建工具友好

### Vite 接入

```ts
import mokup from 'mokup/vite'

export default {
  plugins: [
    mokup({
      entries: { dir: 'mock', prefix: '/api' },
    }),
  ],
}
```

然后这时候 你就可以在 `mock/` 目录里放 mock 文件了，Mokup 会自动扫描并生成对应的路由。

你也可以在你的 CLI 中快速访问 mokup 的 playground 进行可视化调试

![CLI](/blog/mokup-unified-mock-library/cli.png)

### Webpack 接入

```js
const { mokupWebpack } = require('mokup/webpack')

const withMokup = mokupWebpack({
  entries: { dir: 'mock', prefix: '/api' },
})

module.exports = withMokup({})
```

你可以在不改动业务代码结构的情况下，把 mock 能力挂到现有构建流程里。

## 可视化：Playground（重点）

Mokup 内置 Playground，用来查看当前被扫描到的路由、方法、路径和配置链。

Vite 开发时默认入口：

```txt
http://localhost:5173/__mokup
```

在线体验 Demo：<https://mokup.icebreaker.top/__mokup/>

![Playground 入口（终端提示）](/blog/mokup-unified-mock-library/playground.png)

它解决的是一个非常实际的问题：
接口不生效时，你不用到处 grep，只要打开页面就能看到“有没有被扫到、有没有被禁用、匹配到了什么配置”。

## 开发体验：哪些文件会热更新

在 Vite dev 下，Mokup 会监听 mock 目录变化并自动刷新路由表。常见会触发热更新的改动包括：

- 新增/修改/删除 mock 路由文件，例如：
  - `mock/users.get.ts`
  - `mock/messages.get.json`
  - `mock/orders/[id].patch.ts`
- 修改目录配置文件：`mock/**/index.config.ts`
- 调整目录结构（移动、重命名、创建子目录）

改完后 Playground 会自动刷新路由列表，调试链路更短。
如果你不需要监听，可以在 `entries` 里配置 `watch: false`。

## 快速示例：从写文件到看到结果

```ts
// mock/users.get.ts
import { defineHandler } from 'mokup'

export default defineHandler({
  handler: c => c.json([{ id: 1, name: 'Ada' }]),
})
```

启动 dev 后访问 `/api/users` (你设置了 `prefix: '/api'` )，即可拿到 mock 数据。

![mock 目录结构示例](/blog/mokup-unified-mock-library/mock-dir.png)

## 快速集成 @faker-js/faker

Mokup 的 handler 本质上就是 TS/JS 函数，所以能直接接入 `@faker-js/faker` 这类 mock 数据库，不需要额外适配层。

下面这个示例会根据查询参数 `size` 返回一组用户列表：

```ts
// mock/users.get.ts
import { faker } from '@faker-js/faker'
import { defineHandler } from 'mokup'

export default defineHandler((c) => {
  const size = Number(c.req.query('size') ?? 10)
  const count = Number.isNaN(size) ? 10 : Math.min(Math.max(size, 1), 50)
  const list = Array.from({ length: count }, () => ({
    id: faker.string.uuid(),
    name: faker.person.fullName(),
    email: faker.internet.email(),
    city: faker.location.city(),
    createdAt: faker.date.recent({ days: 30 }).toISOString(),
  }))

  return c.json({
    list,
    total: 200,
    page: 1,
    pageSize: count,
  })
})
```

这对列表页、搜索页、详情页联调都很实用。
如果你希望测试结果可复现，可以在 handler 顶部加上 `faker.seed(123)`。

## 可部署到多个环境

这套 mock 可以运行在多个环境：比如在 Node.js 里直接使用，甚至还能部署到 Cloudflare Worker。

Node.js 直接使用示例：

```ts
import { createFetchServer, serve } from 'mokup/server/node'

const app = await createFetchServer({ entries: { dir: 'mock' } })
serve({ fetch: app.fetch, port: 3000 })
```

部署到 Cloudflare Worker 示例：

```ts
import { createMokupWorker } from 'mokup/server/worker'
import mokupBundle from 'virtual:mokup-bundle'

export default createMokupWorker(mokupBundle)
```

提示：`virtual:mokup-bundle` 仅在 Vite 与 `@cloudflare/vite-plugin` 集成环境可用；Node.js Dev 模式可直接使用 `createFetchServer`，无需该虚拟模块。

## 核心架构

![mock 目录结构示例](/blog/mokup-unified-mock-library/core-en.png)

## 适用场景与边界

适合：

- 已有 Vite/webpack 工程，想低成本接入 mock 的团队
- 需要可视化路由排查能力的项目
- 重视开发反馈速度，希望 mock 修改后立即可见的场景

不太适合：

- 主要依赖复杂动态代理链路的场景
- 完全不希望引入构建期/插件能力的极轻量脚本方案

Mokup 不是为了替代所有 mock 方案，而是让 mock 更快接入、更好调试、更贴近日常开发流程。

## 结语

Mokup 目前还在快速迭代中，欢迎大家试用并提反馈！无论是功能需求、使用体验还是文档改进都非常欢迎。
