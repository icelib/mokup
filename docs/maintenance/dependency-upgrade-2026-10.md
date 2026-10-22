# 2026-10-15 依赖升级记录

本次升级覆盖全部 19 个依赖清单、共享 catalog、overrides 和锁文件中的传递依赖，并整合 main 上已有的 repoctl 工程化与功能修复。已发布包的公开导出、Vite 与 Webpack peer 支持范围保持一致。

## 环境与兼容性

- 全部 9 个发布包要求 Node.js >=22.12.0，不再支持 Node.js 20；已添加对应 major 发布意图，交由现有 repoctl 发布流程处理。
- 开发与构建沿用 main 的 Node.js >=24.15.0 基线，CI 与 .node-version 使用 Node.js 24，并保留 Linux、macOS、Windows 矩阵。
- 已确认的两项保留：TypeScript ^6.0.3，等待 ESLint、Vue 和 ts-loader 支持 TypeScript 7 的编译器 API；VitePress 固定 2.0.0-alpha.18，避免稳定版 1.x 带回旧构建工具。
- 测试环境使用 jsdom ^30.1.2，兼容 Node.js 24.15.0 基线；@types/node 更新为 ^24.19.2，与开发 Node 主版本一致。
- 保留 1440 分钟的发布时间限制、strictDepBuilds 和上游 allowBuilds 审批清单，其中 esbuild、msgpackr-extract 均为 true；Better Auth 使用已满足发布时间限制的 1.7.7，workers-types 使用 5.20261014.1。

## 版本变化

下表以初次升级的原始依赖清单为比较基线，合并重复声明，并将 catalog 引用展开为整合 main 后的实际范围；不是相对当前 main 的完整版本差异。repoctl、jsdom 和 @types/node 另注明 main 的既有范围。Changesets 及原先直接声明的 @icebreakers 工具包已由 repoctl 接管，不再作为直接依赖列出。

| 依赖                         | 原范围         | 新范围        |
| ---------------------------- | -------------- | ------------- |
| pnpm                         | 11.15.1        | 12.11.2       |
| @cloudflare/vite-plugin      | ^1.45.1        | ^1.64.0       |
| @cloudflare/workers-types    | ^5.20260719.1  | ^5.20261014.1 |
| @codemirror/language         | ^6.12.4        | ^6.13.1       |
| @codemirror/state            | ^6.7.1         | ^6.7.6        |
| @codemirror/view             | ^6.43.6        | ^6.43.14      |
| @commitlint/cli              | ^21.2.1        | ^21.2.3       |
| @faker-js/faker              | ^10.5.0        | ^10.6.0       |
| @hono/node-server            | ^2.0.10        | ^2.1.5        |
| @iconify-json/carbon         | ^1.2.24        | ^1.2.28       |
| @playwright/test             | ^1.61.1        | ^1.64.1       |
| @types/node                  | main: ^24.19.1 | ^24.19.2      |
| @types/semver                | ^7.7.1         | ^7.8.0        |
| @types/ws                    | ^8.18.1        | ^8.18.2       |
| @vitejs/plugin-vue           | ^6.0.8         | ^6.0.10       |
| @vitest/coverage-v8          | ~4.1.10        | ~5.0.4        |
| @vue/compiler-sfc            | ^3.5.40        | ^3.5.44       |
| axios                        | ^1.18.1        | ^1.20.0       |
| better-auth                  | ^1.6.23        | ^1.7.7        |
| css-loader                   | ^7.1.4         | ^7.1.5        |
| drizzle-kit                  | ^0.31.10       | ^0.31.11      |
| drizzle-orm                  | ^0.45.2        | ^0.45.4       |
| es-toolkit                   | ^1.49.0        | ^1.52.0       |
| eslint                       | ^10.7.0        | ^10.12.0      |
| execa                        | ^10.0.0        | ^10.1.1       |
| express                      | ^5.2.1         | ^5.3.0        |
| fs-extra                     | ^11.3.6        | ^11.4.1       |
| hono                         | ^4.12.31       | ^4.13.13      |
| html-webpack-plugin          | ^5.6.7         | ^5.6.8        |
| jsdom                        | main: ^30.1.1  | ^30.1.2       |
| lint-staged                  | ^17.1.0        | ^17.6.0       |
| pkg-types                    | ^2.3.1         | ^2.3.3        |
| repoctl                      | main: ^5.9.0   | ^5.10.3       |
| rolldown                     | 1.2.0          | 1.2.14        |
| stylelint                    | ^17.14.1       | ^17.16.0      |
| tailwind-merge               | ^3.6.0         | ^3.7.0        |
| tailwind-variants            | ^3.2.2         | ^3.3.1        |
| tsdown                       | 0.22.12        | 0.23.1        |
| tsx                          | ^4.23.1        | ^4.23.15      |
| turbo                        | ^2.10.5        | ^2.11.8       |
| type-fest                    | ^5.8.0         | ^5.10.0       |
| vite                         | ^8.1.5         | ^8.3.4        |
| vite-plugin-pwa              | ^1.3.0         | ^2.0.0        |
| vitepress-plugin-group-icons | ^1.7.5         | ^1.7.7        |
| vitepress-plugin-llms        | ^1.13.3        | ^1.14.0       |
| vitest                       | ~4.1.10        | ~5.0.4        |
| vue                          | ^3.5.40        | ^3.5.44       |
| vue-i18n                     | ^11.4.7        | ^11.4.14      |
| vue-router                   | ^5.2.0         | ^5.4.0        |
| vue-tsc                      | ~3.3.7         | ^3.3.13       |
| webpack                      | ^5.108.4       | ^5.111.1      |
| webpack-cli                  | ^7.2.1         | ^7.2.3        |
| wrangler                     | ^4.112.0       | ^4.151.0      |
| ws                           | ^8.21.1        | ^8.22.0       |
| yaml                         | ^2.9.0         | ^2.9.1        |

## 配置与适配

- .npmrc 仅保留 registry，其余受支持配置集中在 pnpm-workspace.yaml；清理过期发布时间豁免并合并重复安全 override。
- 共享依赖版本以 pnpm-workspace.yaml 的 catalog 为唯一来源，各依赖清单使用 catalog 引用。Rolldown catalog 为 1.2.14；不设置全局 Rolldown override，避免覆盖 Vite、tsdown 等工具各自声明的兼容范围。esbuild override 为 0.28.2。
- 定向覆盖旧 oxfmt 的 tinypool 为 ^2.2.0、micromark-extension-math 的 KaTeX 为 ^0.19.0。
- 共享 ESLint、Stylelint、commitlint 与 lint-staged 配置由 repoctl ^5.10.3 的 tooling 入口提供；保留上游 repoctl.config.ts 与发布约定。发布意图继续存放于 .changeset/，使用 pnpm change 创建、pnpm 12 原生版本管理生成版本，repoctl 执行发布。
- 将上游针对 @icebreakers/monorepo 5.9.0 的 checkpoint 补丁移植到 5.10.3，保留发布状态分支初始化、并发创建和错误处理修复；整合后的发行工具回归已通过 8 项测试。
- 发布检查先完成构建，再运行测试，避免构建清理 dist 与测试读取 dist 并发；使用根测试入口保留覆盖率门槛。
- Vitest 5 默认清理 mock 调用记录。保留上游测试的 beforeEach mock 重置及预览服务静态 SW 行为断言，保持覆盖率门槛不变。
- pnpm 12 自动将 LICENSE 放入 tarball，打包白名单允许该文件。
- D1 示例改用显式 middleware 配置，确保 Worker 读取中间件；Better Auth 1.7.3 已撤回 issuer 要求，本次未修改数据库结构或迁移文件。
- 文档 HMR 测试保留上游 fetchMock 复用与失败时的 Service Worker 诊断，仅在导航销毁执行上下文时重试，继续检查 TS、JSON mock 的最终内容。

## 验证结果

以下结果来自整合 main 后的代码，在 macOS、Node.js 24.20.0、pnpm 12.11.2 上分别执行各项检查；未将其表述为完整 release:check 命令的一次运行。跨系统 CI 状态以 PR #33 的最终运行记录为准。

| 检查                       | 最终结果                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------- |
| 冻结锁文件安装 / peer 检查 | 通过                                                                                |
| 迁移守卫                   | 18 个包清单通过；守卫单测 20 项通过                                                 |
| repoctl 发行工具回归       | 8 项通过                                                                            |
| repo doctor                | 26 项通过，0 警告、0 失败                                                           |
| 类型检查                   | 26 个任务通过                                                                       |
| 全量构建                   | 16 个任务通过，包含中英文文档、LLMs 输出和 PWA Service Worker                       |
| 全仓单测                   | 227 个文件通过、1 个文件跳过；1574 项通过、1 项跳过、1 项 todo                      |
| 覆盖率                     | 语句 90.79%、分支 85.41%、函数 91.3%、行 90.85%                                     |
| 类型测试 / 打包检查        | 8 个包的类型测试通过；9 个发布包的打包检查通过                                      |
| 完整串行 E2E               | 82 项通过：根目录 37 项、9 个应用共 45 项                                           |
| 独立 D1 身份验证           | 1 项通过；隔离本地数据库、假 OAuth 配置，无远程数据库操作                           |
| 独立消费者                 | Node.js 22.12.0 和 22.23.2 均通过完整成品运行时检查，覆盖 9 个发布包、81 个公开导出 |
| 发布包 Vite 5–8 兼容性     | 8 个版本通过                                                                        |
| CI 系统矩阵                | [PR #33 的最新 CI 记录](https://github.com/sonofmagic/mokup/pull/33/checks)         |

D1 测试使用原 schema，并包含由 Better Auth 1.6.23 生成的密码 hash、credential 与 GitHub 关联账号。用例覆盖旧密码登录、关联账号读取、新注册、session、退出、再次登录、用户创建与列表、重复用户 409；不包含真实 GitHub OAuth 回调。

独立消费者位于系统临时目录，启用 engine-strict，只安装本地发布 tarball 及其生产依赖；不依赖仓库开发依赖。CI 配置在 Node.js 24 打包后切换到 22.12.0 与最新 22 执行检查，并保留上游的运行时请求、模块加载及 Vite 5–8 兼容用例。

## 安全审计

整合后的全量及生产依赖审计均剩 1 条 high，无 critical、moderate 或 low。残留为 [braces <=3.0.3 的嵌套模式栈耗尽](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)；最新审计元数据的 patched_versions 为 null，上游尚无可安装的修复版本。

生产审计列出以下两条 optional peer 路径：

- apps/mokup-web-demo → vue-router → unplugin → webpack → webpack-cli → webpack-dev-server → http-proxy-middleware → micromatch → braces
- packages/mokup → webpack → webpack-cli → webpack-dev-server → http-proxy-middleware → micromatch → braces

触发条件是将深度嵌套的不可信 brace 模式传入同步解析。完整审计还包含开发工具链路径，全部结果保存在 [全量审计快照](./audit-full-2026-10-15.json)；生产依赖路径见 [生产审计快照](./audit-production-2026-10-15.json)。审计命令因这条 high 告警返回非零，未隐藏该结果。
