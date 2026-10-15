# 安装

## 前置要求

- Node.js `>=22.12.0`
- pnpm（推荐）

参与本仓库开发时，使用 Node.js 24 LTS（24.x 中不低于 24.15.0 的版本）和 pnpm 12.8.1。已发布包的运行时要求仍为上面的版本范围。

## 安装依赖

开发工具（Vite 插件 + CLI）：

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

运行时/服务端适配器（部署或中间件）：

::: code-group

```bash [pnpm]
pnpm add mokup
```

```bash [npm]
npm install mokup
```

```bash [yarn]
yarn add mokup
```

```bash [bun]
bun add mokup
```

:::

如果你只做本地 Vite 开发，把 `mokup` 装在 devDependencies 即可。

如果你是从旧版本升级，请先阅读[升级到 v1](/zh/getting-started/upgrade-to-v1)。
