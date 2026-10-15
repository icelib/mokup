# 2026-10-15 依赖升级记录

本次升级覆盖全部 19 个依赖清单、共享 catalog、overrides 和锁文件中的传递依赖。已发布包的公开导出、Vite 与 Webpack peer 支持范围保持一致。

## 环境与兼容性

- 全部 9 个发布包要求 Node.js >=22.12.0，不再支持 Node.js 20；已添加对应 major changeset。
- 开发与构建要求 Node.js ^24.11.0 || >=26.0.0，CI 使用 Node.js 24，并保留 Linux、macOS、Windows 矩阵。
- 已确认的两项保留：TypeScript ^6.0.3，等待 ESLint、Vue 和 ts-loader 支持 TypeScript 7 的编译器 API；VitePress 固定 2.0.0-alpha.18，避免稳定版 1.x 带回旧构建工具。
- 显式补充测试环境 jsdom ^29.1.1。30.x 要求 Node.js 24.15.0+，29.1.1 是兼容已确认开发下限 24.11 的最新主版本系列。
- 保留 1440 分钟的发布时间限制和原有构建审批；Better Auth 使用已满足限制的 1.7.7，workers-types 使用 5.20261014.1。

## 版本变化

下表合并重复声明，catalog 引用展开为实际版本范围；未变化的依赖省略。

| 依赖                           | 原范围        | 新范围        |
| ------------------------------ | ------------- | ------------- |
| pnpm                           | 11.15.1       | 12.11.2       |
| @changesets/cli                | ^2.31.1       | ^3.0.3        |
| @cloudflare/vite-plugin        | ^1.45.1       | ^1.64.0       |
| @cloudflare/workers-types      | ^5.20260719.1 | ^5.20261014.1 |
| @codemirror/language           | ^6.12.4       | ^6.13.1       |
| @codemirror/state              | ^6.7.1        | ^6.7.6        |
| @codemirror/view               | ^6.43.6       | ^6.43.14      |
| @commitlint/cli                | ^21.2.1       | ^21.2.3       |
| @faker-js/faker                | ^10.5.0       | ^10.6.0       |
| @hono/node-server              | ^2.0.10       | ^2.1.5        |
| @icebreakers/changelog-github  | ^2.0.0        | ^2.1.5        |
| @icebreakers/commitlint-config | ^4.0.2        | ^4.1.2        |
| @icebreakers/eslint-config     | ^7.0.1        | ^8.0.9        |
| @icebreakers/monorepo          | ^5.0.2        | ^5.10.3       |
| @icebreakers/stylelint-config  | ^5.0.2        | ^5.1.3        |
| @iconify-json/carbon           | ^1.2.24       | ^1.2.28       |
| @playwright/test               | ^1.61.1       | ^1.64.1       |
| @types/node                    | ^26.1.1       | ^26.6.5       |
| @types/semver                  | ^7.7.1        | ^7.8.0        |
| @types/ws                      | ^8.18.1       | ^8.18.2       |
| @vitejs/plugin-vue             | ^6.0.8        | ^6.0.10       |
| @vitest/coverage-v8            | ~4.1.10       | ~5.0.4        |
| @vue/compiler-sfc              | ^3.5.40       | ^3.5.44       |
| axios                          | ^1.18.1       | ^1.20.0       |
| better-auth                    | ^1.6.23       | ^1.7.7        |
| css-loader                     | ^7.1.4        | ^7.1.5        |
| drizzle-kit                    | ^0.31.10      | ^0.31.11      |
| drizzle-orm                    | ^0.45.2       | ^0.45.4       |
| es-toolkit                     | ^1.49.0       | ^1.52.0       |
| eslint                         | ^10.7.0       | ^10.12.0      |
| execa                          | ^10.0.0       | ^10.1.1       |
| express                        | ^5.2.1        | ^5.3.0        |
| fs-extra                       | ^11.3.6       | ^11.4.1       |
| hono                           | ^4.12.31      | ^4.13.13      |
| html-webpack-plugin            | ^5.6.7        | ^5.6.8        |
| jsdom                          | 新增          | ^29.1.1       |
| lint-staged                    | ^17.1.0       | ^17.6.0       |
| pkg-types                      | ^2.3.1        | ^2.3.3        |
| rolldown                       | 1.2.0         | 1.2.14        |
| stylelint                      | ^17.14.1      | ^17.16.0      |
| tailwind-merge                 | ^3.6.0        | ^3.7.0        |
| tailwind-variants              | ^3.2.2        | ^3.3.1        |
| tsdown                         | 0.22.12       | 0.23.1        |
| tsx                            | ^4.23.1       | ^4.23.15      |
| turbo                          | ^2.10.5       | ^2.11.8       |
| type-fest                      | ^5.8.0        | ^5.10.0       |
| vite                           | ^8.1.5        | ^8.3.4        |
| vite-plugin-pwa                | ^1.3.0        | ^2.0.0        |
| vitepress-plugin-group-icons   | ^1.7.5        | ^1.7.7        |
| vitepress-plugin-llms          | ^1.13.3       | ^1.14.0       |
| vitest                         | ~4.1.10       | ~5.0.4        |
| vue                            | ^3.5.40       | ^3.5.44       |
| vue-i18n                       | ^11.4.7       | ^11.4.14      |
| vue-router                     | ^5.2.0        | ^5.4.0        |
| vue-tsc                        | ~3.3.7        | ~3.3.13       |
| webpack                        | ^5.108.4      | ^5.111.1      |
| webpack-cli                    | ^7.2.1        | ^7.2.3        |
| wrangler                       | ^4.112.0      | ^4.151.0      |
| ws                             | ^8.21.1       | ^8.22.0       |
| yaml                           | ^2.9.0        | ^2.9.1        |

## 配置与适配

- .npmrc 仅保留 registry，其余受支持配置迁入 pnpm-workspace.yaml；清理过期发布时间豁免并合并重复安全 override。
- Rolldown catalog、运行时依赖和 override 同步为 1.2.14；esbuild override 为 0.28.2。
- 定向覆盖旧 oxfmt 的 tinypool 为 ^2.2.0、micromark-extension-math 的 KaTeX 为 ^0.19.0，后者通过数学解析与 trust 安全回归验证。
- Changesets 3 使用新 schema，显式保留私有包 version=true/tag=false；版本生成交给现有 Action，发布脚本移除重复 version。
- 发布检查先完成构建，再运行测试，避免构建清理 dist 与测试读取 dist 并发；使用根测试入口保留覆盖率门槛。
- Vitest 5 默认清理 mock 调用记录。修正一处依赖前序用例记录的断言，保持覆盖率门槛不变。
- pnpm 12 自动将 LICENSE 放入 tarball，打包白名单允许该文件。
- D1 示例改用显式 middleware 配置，确保 Worker 读取中间件；Better Auth 1.7.3 已撤回 issuer 要求，本次未修改数据库结构或迁移文件。
- 文档 HMR 测试仅在导航销毁执行上下文时重试，继续检查 TS、JSON mock 的最终内容。

## 验证结果

完整 release:check 已通过。开发验证使用 macOS、Node.js 24.20.0、pnpm 12.11.2。Linux 和 Windows 的执行结果由保留的 CI 矩阵验证，本地未模拟这两个系统。

| 检查                         | 结果                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 冻结锁文件安装 / peer 检查   | 通过，无 peer 冲突                                                                                                |
| 迁移守卫 / 行数守卫          | 通过                                                                                                              |
| 类型检查 / ESLint、Stylelint | 通过；仅有依赖替换建议警告                                                                                        |
| 全量构建                     | 16 个任务通过，包含中英文文档、LLMs 输出和 PWA Service Worker                                                     |
| 全仓单测                     | 609 项通过，1 项原有 todo；语句 87.86%、分支 80.58%、函数 89.49%、行 87.81%                                       |
| 类型测试 / 打包检查          | 通过；8 个库包完成结构检查，9 个发布包均完成独立打包安装                                                          |
| 全量 E2E                     | 根目录 9 项、应用 44 项通过，覆盖 HMR、Service Worker、PWA bridge                                                 |
| 独立 D1 身份验证             | 通过；隔离本地数据库、假 OAuth 配置，无远程数据库操作                                                             |
| 独立消费者                   | 9 个本地 tarball 在 Node.js 22.12.0 和 22.23.2 上安装并通过 CLI、TS/JSON mock、Fetch/Worker、HTTP、WebSocket 检查 |

D1 测试使用原 schema，并包含由 Better Auth 1.6.23 生成的密码 hash、credential 与 GitHub 关联账号。覆盖旧密码登录、关联账号读取、新注册、session、退出、再次登录、用户创建与列表、重复用户 409；不包含真实 GitHub OAuth 回调。

独立消费者位于系统临时目录，启用 engine-strict，只安装本地发布 tarball 及其生产依赖；不依赖仓库开发依赖。CI 在 Node.js 24 打包后切换到 22.12.0 与最新 22 执行相同检查。

## 安全审计

全量审计从 113 条告警（6 critical）降至 1 条 high；生产依赖审计也只剩同一条 high，无 critical、moderate 或 low。

残留为 [braces <=3.0.3 的嵌套模式栈耗尽](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)。审计时 registry 最新仍为 3.0.3，上游未发布修复版本。触发条件是将深度嵌套的不可信 brace 模式传入同步解析；未通过替换 glob 实现来规避审计。

生产审计列出的完整路径（均来自 optional peer 链）：

- apps/mokup-web-demo → vue-router → unplugin → webpack → webpack-cli → webpack-dev-server → http-proxy-middleware → micromatch → braces
- packages/mokup → html-webpack-plugin → webpack → webpack-cli → webpack-dev-server → http-proxy-middleware → micromatch → braces
- packages/mokup → webpack → webpack-cli → webpack-dev-server → http-proxy-middleware → micromatch → braces

完整审计还包含 tsd → globby → fast-glob → micromatch → braces，以及 monorepo、ESLint、Stylelint 的同类工具链路径。全部路径保存在同目录的 audit-full-2026-10-15.json；生产路径保存在 audit-production-2026-10-15.json。审计命令因这条 high 告警返回非零属于预期，未声称审计零告警。
