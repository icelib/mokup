# 框架适配器

Mokup 的服务端适配器把同一个 Fetch runtime 暴露给 Next.js、Nuxt/Nitro 和 Astro。适配器不依赖框架包，因此可以直接用于应用、测试和自定义运行时，Mock 文件也不需要改写。

## Next.js App Router

在 route module 中直接导出方法：

```ts
// app/api/[...path]/route.ts
import { createNextRouteHandler } from '@mokup/server/next'

const routes = createNextRouteHandler({
  manifest: { version: 1, routes: [] }, // 替换为生成的 .mokup manifest
  onNotFound: 'response',
})

export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = routes
```

Resolver 接收标准 `Request`，完整的 Next route context 位于 `context.context.next`。`routes.use`、`routes.resetHandlers`、`routes.events`、`routes.selectScenario` 和 `routes.close` 与其他适配器共享同一套控制 API。

Pages Router API route 可以使用 `createNextApiHandler`：

```ts
import { createNextApiHandler } from '@mokup/server/next'

export default createNextApiHandler({ manifest })
```

## Nuxt 和 Nitro

`createNuxtHandler` 同时支持 Fetch event 和 Node Nitro event：

```ts
// server/api/[...path].ts
import { createNuxtHandler } from '@mokup/server/nuxt'

export default createNuxtHandler({ manifest, onNotFound: 'response' })
```

Nitro 提供 `event.request` 时适配器使用它；Node 部署则回退到 `event.node.req`/`event.node.res`。原始 event 位于 `context.context.nuxt`。

## Astro

Astro endpoint 可以直接导出方法表：

```ts
// src/pages/api/[...path].ts
import { createAstroEndpoint } from '@mokup/server/astro'

export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = createAstroEndpoint({
  manifest,
  onNotFound: 'response',
})
```

原始 Astro endpoint context 位于 `context.context.astro`，请求匹配仍使用原始 Fetch `Request`。

## Runtime 与 fallback

三个适配器在没有命中 Mock 路由时默认返回明确的 `404`。宿主框架提供下游 fallback 时可以设置 `onNotFound: 'next'`；如果 route module 没有下游处理器，Mokup 完成后仍会返回 `404`。每次工厂调用都会创建独立 session，适合并行测试。
