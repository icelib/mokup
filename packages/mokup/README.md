# mokup

English | [Chinese](./README.zh-CN.md)

## Overview

Mokup provides file-based mock routing, a Vite plugin, and a playground UI to help you build and debug API mocks locally. For detailed usage, see https://mokup.icebreaker.top.

## Diagnostics

Mokup supports strict diagnostics through `errorOn`, so invalid routes,
duplicate routes, missing handlers, and service worker config conflicts can
fail builds or startup instead of only printing warnings.

See:

- https://mokup.icebreaker.top/reference/diagnostics
- https://mokup.icebreaker.top/reference/vite-plugin
- https://mokup.icebreaker.top/reference/webpack-plugin
- https://mokup.icebreaker.top/reference/cli

## Requirements

- Node.js `>=22.12.0`

## Upgrade notes

- Published packages now ship ESM-only output.
- Shared build helpers are available from `@mokup/shared/rolldown`.
- Full migration guide: [../../docs/guide/migration-v1.md](../../docs/guide/migration-v1.md)
