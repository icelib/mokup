# Mokup v1 迁移指南

本文档汇总了本次 breaking change 升级需要关注的点。

相关入口：

- 根说明：[../../README.md](../../README.md)
- Vite 集成：[./vite-integration.md](./vite-integration.md)

## 1. Node.js 版本要求

所有公开包现在都要求：

```text
>=22.12.0
```

Node.js 20 及更早版本不再受支持。仓库开发和构建要求 Node.js `^24.11.0 || >=26.0.0`，成品包在 Node.js 22.12.0 及以上版本运行。

## 2. 包输出改为 ESM-only

所有已发布包现在只提供 ESM 输出。

受影响示例：

```js
const mokup = require('mokup')
```

这类 CommonJS `require()` 用法不再受支持，需要改为 ESM：

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

当前仓库内部统一使用 `@mokup/shared/rolldown` 的 `build()` 能力，底层实现已经切到 Rolldown。

## 4. 构建工具链变更

已发布包的构建链已经从 `unbuild` / `tsup` 切换为 `tsdown`。

如果你在仓库内扩展包配置，应该优先使用：

- `tsdown.config.ts`
- `tsdown --watch`

而不是旧的 `build.config.ts`、`tsup` 或 `unbuild` 配置。

## 5. 需要优先检查的升级项

- CI / Docker / 部署环境里的 Node.js 版本
- 是否还有 CommonJS `require()` 引用公开包
- 是否还有 `@mokup/shared/esbuild` 旧导入
- 是否还有旧的包构建脚本或 `build.config.ts`

## 6. 仓库当前状态

当前仓库已经完成以下迁移：

- 发布包统一为 ESM-only
- 发布包统一使用 `tsdown`
- `tsdown` 实际构建已固定到 `rolldown@1.2.14`
- 单元测试、类型测试、串行 e2e 测试已通过
