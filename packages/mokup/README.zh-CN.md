# mokup

[English](./README.md) | 中文

## 概览

Mokup 提供基于文件的 mock 路由、Vite 插件和 Playground UI，帮助你在本地构建与调试接口。完整文档见 https://mokup.icebreaker.top。

## Diagnostics

Mokup 支持通过 `errorOn` 开启严格诊断，让非法路由、重复路由、缺失
handler 和 service worker 配置冲突不再只是 warning，而是直接让构建或启动失败。

可参考：

- https://mokup.icebreaker.top/zh/reference/diagnostics
- https://mokup.icebreaker.top/zh/reference/vite-plugin
- https://mokup.icebreaker.top/zh/reference/webpack-plugin
- https://mokup.icebreaker.top/zh/reference/cli

## 环境要求

- Node.js `>=22.12.0`

## 升级提示

- 已发布包现在只提供 ESM 输出。
- 共享构建辅助入口统一使用 `@mokup/shared/rolldown`。
- 完整迁移说明见：[../../docs/guide/migration-v1.md](../../docs/guide/migration-v1.md)
