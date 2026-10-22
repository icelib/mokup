# @mokup/server

[English](./README.md) | 中文

## 概览

Mokup 的 Server 适配器集合，用于把运行时接入各类 Node 框架与 Worker。完整文档见 https://mokup.icebreaker.top。

## 环境要求

- Node.js `>=22.12.0`

## 升级提示

- 该包现在只提供 ESM 输出。
- 完整迁移说明见：[../../docs/guide/migration-v1.md](../../docs/guide/migration-v1.md)

该包为 `mokup` 内部依赖，建议使用下方公开入口。

## 入口说明

- `mokup/server`：Node 适配器与开发服务器
- `mokup/server/node`：Node `serve` 入口
- `mokup/server/fetch`：运行时无关的 fetch 入口 + 类型
- `mokup/server/worker`：Worker helper，封装 `createFetchHandler` 并在 `null` 时返回 404
