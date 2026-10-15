# Webpack 插件

使用 `mokup/webpack` 在 webpack-dev-server 与构建产物中接入 Mokup。

## 安装

::: code-group

```bash [pnpm]
pnpm add -D mokup
```

```bash [npm]
npm install -D mokup
```

```bash [yarn]
yarn add -D mokup
```

```bash [bun]
bun add -d mokup
```

:::

## 基本用法

使用场景：

- 在 webpack-dev-server 中接入 Mokup mock。
- 构建时输出 SW 资源用于浏览器侧 mock。

推荐（使用封装函数）：

```ts
import { mokupWebpack } from 'mokup/webpack'

const withMokup = mokupWebpack({
  entries: {
    dir: 'mock',
    prefix: '/api',
  },
})

export default withMokup({})
```

直接使用插件（短名称）：

```ts
import { createWebpackPlugin } from 'mokup/webpack'

export default {
  plugins: [
    createWebpackPlugin({
      entries: {
        dir: 'mock',
        prefix: '/api',
      },
    }),
  ],
  devServer: {},
}
```

## Service Worker 模式

使用场景：

- 在浏览器 Service Worker 中运行 mock 处理器。
- dev 与 build 共用同一套 mock 目录。

示例：

```ts
import { createWebpackPlugin } from 'mokup/webpack'

export default {
  plugins: [
    createWebpackPlugin({
      entries: {
        dir: 'mock',
        prefix: '/api',
        mode: 'sw',
        sw: {
          path: '/mokup-sw.js',
          scope: '/',
        },
      },
    }),
  ],
}
```

## 选项

选项与 Vite 插件一致：顶层 `entries` + `playground`，以及每个 entry 的配置，详见 [Vite 插件](./vite-plugin)。

## 严格诊断

webpack 模式同样支持 `errorOn`。开启后，命中的诊断不会只输出 warning，
而是直接使启动或构建失败。

示例：

```ts
import { createWebpackPlugin } from 'mokup/webpack'

export default {
  plugins: [
    createWebpackPlugin({
      errorOn: ['invalid-route', 'sw-conflict'],
      entries: {
        dir: 'mock',
        prefix: '/api',
        mode: 'sw',
      },
    }),
  ],
}
```

支持的类别与 Vite 一致：`invalid-route`、`unsupported-fields`、
`missing-handler`、`duplicate-route`、`sw-conflict`。

## 注意

- 已发布包现在只提供 ESM。推荐使用 `webpack.config.ts` 或 `webpack.config.mjs`。
- Dev server 会通过 `devServer.setupMiddlewares` 注入中间件，请确保启用了 `webpack-dev-server`。
- 关闭 Webpack watch 时会取消排队中的 mock 刷新，并丢弃尚未完成的结果；重新启动 watch 后会恢复 mock 文件监听。路由与 SW bundle 在刷新成功后一起更新，刷新失败时保留上一次成功的结果。
- 监听启动期间发生的文件修改，会在文件监听就绪后补充刷新。
- `mokupWebpack(...)` 会自动创建 `devServer` 对象，除非需要自定义 dev-server 设置，否则可以省略。
- SW 生命周期脚本会输出到 assets 目录（默认 `assets/mokup-sw-lifecycle.js`）。如果使用 `html-webpack-plugin` 会自动注入，否则需要手动引入。
