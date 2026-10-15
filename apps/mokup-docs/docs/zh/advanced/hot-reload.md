# 热更新与调试

Mokup 在 Vite dev 中会监听 mock 目录的文件变化，并自动刷新路由表。

## 开启/关闭监听

```ts
import mokup from 'mokup/vite'

export default {
  plugins: [
    mokup({
      entries: {
        dir: 'mock',
        watch: true,
      },
    }),
  ],
}
```

若不需要监听（例如预览环境），可设 `watch: false`。

## 原生模块刷新

通过原生加载器运行时，例如独立的 [Fetch 服务](../reference/server.md#fetch-入口-node)，
ESM 格式的 `.js`、`.mjs` 入口、CommonJS 格式的 `.cjs` 入口及 TypeScript `.ts` 入口刷新不依赖系统时钟前进。
即使连续刷新发生在同一毫秒内，或系统时间被调整，入口仍会重新加载；通过符号链接访问的入口也可以刷新。

TypeScript 遵循最近的 `package.json`：`"type": "module"` 使用 ESM，CommonJS 或未声明 `type` 时使用 CommonJS。
两种格式都支持 TypeScript 默认导出，ESM 保留顶层 await。
原生加载器沿用进程级 tsconfig；多个项目需要独立的 TypeScript 别名配置时，应使用不同进程。

这种刷新针对 mock 或配置入口本身。入口已经 `import` 或 `require` 的辅助模块、共享依赖仍会保留缓存；
修改这些依赖后，即使刷新了入口，也可能需要重启使用原生加载器的服务进程。
Vite dev 对其加载的模块使用 Vite 的模块图失效机制，依赖更新遵循该模块图。

## Vite 刷新

Vite 开发模式下，当所有条目均使用 SW 模式、自动注册且设置 `sw.fallback: false` 时，两种 runtime 都通过 SW 更新器刷新 mock 响应，不会在每次编辑时重载页面。
路由从空变为非空时仍可能重载页面，以启动注册流程。
Worker runtime 中启用服务端 fallback、混合服务端路由或手动注册 SW 的配置继续保留整页刷新行为。

刷新会在扫描和路由 app 构建成功后，同时更新路由表、Playground 元数据和 Service Worker 路由数据。
如果 `errorOn` 将诊断提升为错误，或路由 app 构建失败，上一次成功的路由快照会继续生效。
诊断仍反映最近一次扫描；修正 mock 或配置后，下一次成功刷新即可生效。

启用监听时，Vite dev 和 preview 的 Node mock 路由都支持从空目录开始。
新增第一条有效路由后，文件监听器会刷新路由表，无需重启服务器。
删除全部路由后，请求会继续交给应用的后续中间件；再次新增路由后恢复 mock。

Vite preview 提供构建时生成的 Service Worker，包括已经打包的处理器和中间件。
修改 SW mock 后需要重新构建才能在 preview 中生效；仅编辑源文件不会替换已构建的快照。
SW 的自动或手动注册方式遵循构建时的 `sw.register` 设置。

在 Vite dev 中，启用 HMR 和 Service Worker 自动注册时，向空路由表新增第一条 SW 路由会自动刷新页面，
以加载注册脚本。删除全部 SW 路由后，已注册的 worker 会更新为空路由表，让请求透传到网络。
`sw.register: false` 仍会关闭自动注册。

在 Vite dev 中，mock 和配置文件成功刷新时会复用 Vite 模块图中已经空闲的入口。
重叠加载使用独立的请求标识，因此标识数量随每个输入的峰值并发量增长，而不会随扫描次数持续增加。
不同别名和查询参数属于不同输入；修复解析失败时也可能需要新的标识。
已导入辅助模块的更新遵循 Vite 的文件监听与依赖图；外部化到 Node 的依赖仍使用 Node 的缓存机制。

## 调试建议

- 路由变化后 Playground 会自动刷新（`mokup:routes-changed`）。
- Service Worker 模式下，安装过程中发生的 mock 修改会排队等待，安装完成后自动更新，无需手动刷新页面。
- 若某个接口不生效，请先检查文件名是否包含 method 后缀。
- TS 处理器支持 `console.log` 输出，Vite dev 会显示日志。

## 调试 mock handler 与中间件

mock handler 和目录中间件运行在 Vite 的 Node 侧，请使用 Node 调试器而不是浏览器 DevTools。

### VSCode（推荐）

1. 打开命令面板执行 **Debug: Create JavaScript Debug Terminal**。
2. 在该终端里启动 dev 命令（例如 `pnpm dev --filter <app>`）。
3. 在 `mock/**/*.ts` 或 `mock/**/index.config.ts` 里打断点。

如需 `launch.json`：

```json
{
  "type": "node",
  "request": "launch",
  "name": "Vite Dev (mock debug)",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["dev", "--filter", "<app>"],
  "cwd": "${workspaceFolder}",
  "env": {
    "NODE_OPTIONS": "--enable-source-maps --inspect"
  },
  "autoAttachChildProcesses": true
}
```

### 终端 + Node Inspector

```bash
NODE_OPTIONS="--inspect-brk --enable-source-maps" pnpm dev --filter <app>
```

然后在 VSCode 使用 “Attach to Node”，或打开 `chrome://inspect` 连接。

### 快速确认

- 在 handler 内加入 `debugger;` 或 `console.log`，确认是否被加载。
- 预览环境可能无法使用 Vite dev 调试，建议用 `dev` 命令。
