# Vite 构建产物

当需要在构建期生成可部署的 mock 产物时，使用 CLI：

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

输出目录结构：

```
.mokup/
  mokup.manifest.json
  mokup.manifest.mjs
  mokup.manifest.d.mts
  mokup.bundle.mjs
  mokup.bundle.d.ts
  mokup.bundle.d.mts
  mokup-handlers/ (可选)
```

`mokup.bundle.mjs` 是最方便的入口文件，适合在 Worker 或自定义运行时中直接导入。

## Service Worker 构建

当在 Vite 插件中设置 `mode: 'sw'` 时，Service Worker 脚本会在 `vite build` 期间输出（默认 `/mokup-sw.js`）。插件会自动注入注册脚本，除非设置 `sw.register: false`。

`sw.path` 可以包含完整的 Vite `base` 前缀。例如 `base: '/workspace/'` 时，`/mokup-sw.js` 和 `/workspace/mokup-sw.js` 都会输出 `dist/mokup-sw.js`，并注册 `/workspace/mokup-sw.js`，不会在构建目录中重复添加 `workspace`。

```ts
import mokup from 'mokup/vite'

export default {
  plugins: [
    mokup({
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

这种方式适合纯静态部署，因为 mock 请求在浏览器侧处理。如果你还需要 playground，可设置 `playground: { build: true }`，在 `vite build` 时输出 Playground 资源与 `/__mokup/routes`。或者继续用 `mokup build` 或脚本生成 `/__mokup/routes` 并随站点发布。

Playground 构建目录必须是 `outDir` 内的独立子目录。归一化后指向 `outDir` 自身或外部、以及经过 `outDir` 内现有符号链接的路径，会在替换输出文件前被拒绝。

Vite 相对于项目 `root` 解析 `build.outDir`，Playground 遵循同一规则。`playground.path` 已包含 `base` 时，磁盘路径不会重复添加该前缀。例如，`base: '/workspace/'` 与 `playground.path: '/workspace/inspect/mocks'` 会输出到 `<outDir>/inspect/mocks`，访问地址为 `/workspace/inspect/mocks/`。

设置 `playground.build: true` 后，`vite preview` 使用构建好的 Playground HTML、资源和路由清单；修改 mock 源文件后需要重新构建，才会更新这些产物。该挂载路径优先于服务端 mock 路由，其他路径仍按原有规则处理。设置 `playground.build: false` 时，预览中的 Playground 继续读取当前 mock 源文件。

在 `vite preview` 中直接打开动态 Playground，也可以自动注册 Service Worker。它使用 `vite build` 已生成的 worker，因此删除源路由不会阻止已有构建产物的注册，修改源码后则需要重新构建才能更新响应。worker 产物缺失时，Playground 不会尝试注册。注册与注销仍遵循当前预览配置中的 `sw.register` 和 `sw.unregister`；即使 worker 文件已删除，显式注销依然有效。

注意：

- `sw.basePath` 用于控制 SW 拦截的请求路径，默认继承 entry 的 `prefix`。
