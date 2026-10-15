# 升级到 v1

本文档汇总了升级到 Mokup v1 时需要优先检查的 breaking change。

相关入口：

- [安装](/zh/getting-started/installation)
- [Vite 插件](/zh/reference/vite-plugin)

## 1. Node.js 版本要求

所有已发布包现在都要求：

```text
>=22.12.0
```

Node.js 20 及更早版本不再受支持。仓库开发和构建要求 Node.js `^24.11.0 || >=26.0.0`，成品包在 Node.js 22.12.0 及以上版本运行。

## 2. 包输出改为 ESM-only

所有已发布包现在只提供 ESM 输出。

下面这类 CommonJS 用法不再受支持：

```js
const mokup = require('mokup')
```

需要改为 ESM：

```ts
import mokup from 'mokup'
```

## 3. `@mokup/shared/esbuild` 已移除

旧入口：

```ts
import { build } from '@mokup/shared/esbuild'
```

现在应直接改为：

```ts
import { build } from '@mokup/shared/rolldown'
```

当前仓库内部统一改用 `@mokup/shared/rolldown`，底层实现已经切到 Rolldown。

## 4. 构建工具链改为 `tsdown`

已发布包的构建链已经从 `unbuild` / `tsup` 切换为 `tsdown`。

如果你在这个 monorepo 里扩展包构建配置，应优先使用：

- `tsdown.config.ts`
- `tsdown --watch`

而不是旧的 `build.config.ts`、`tsup` 或 `unbuild` 配置。

## 5. 升级检查清单

- 确认 CI、Docker、部署环境里的 Node.js 版本已升级
- 替换所有公开包的 CommonJS `require()` 用法
- 替换所有 `@mokup/shared/esbuild` 旧导入
- 清理旧的包构建脚本或 `build.config.ts`

## 6. 仓库当前状态

当前仓库已经完成以下迁移：

- 发布包统一为 ESM-only
- 发布包统一使用 `tsdown`
- `tsdown` 实际构建固定到 `rolldown@1.2.14`
- 单元测试、类型测试、串行 e2e 测试已通过
