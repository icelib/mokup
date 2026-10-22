# 合并 main 后的依赖与验证记录（2026-10-22）

## 基线与当前契约

本报告对比提交 `49a45a4` 与合入 `origin/main@4b354c1` 后重新安装、生成锁文件的工作区。main 包含 `834958d` 的 npmmirror 发布后同步及 `4b354c1` 的依赖和 Node 支持策略更新。合并前的数据与测试保留在 [原依赖评估报告](./dependencies-2026-10-22.md)，其中的“最终”仅指该历史阶段。

用户已明确选择跟随 main：全部 10 个发布包（含新增的 `@mokup/msw`）最低 Node.js 版本统一为 `>=22.12.0`，不再承诺 Node.js 20。根项目及 10 个私有应用继续使用 `>=24.15.0 <25` 开发，包管理器由 pnpm 12.8.1 更新为 12.11.2。现有 9 个已发布包的 major 发布意图沿用 main；本次合并没有直接改动各 package 的 version 字段。

合并前后均有 21 个 manifest/importer、94 个不同外部直接依赖、189 条依赖/开发依赖/peer 声明（包含内部 workspace 声明）。逐项比对没有新增、删除或遗漏直接依赖；25 项外部直接依赖的声明或解析版本变化，其余 69 项保持合并前的声明和直接解析版本。

## 直接依赖变化与合并选择

[原报告的 94 项完整清单](./dependencies-2026-10-22.md#外部直接依赖全量清单)列明全部包的用途及声明位置；以下 25 项替换该历史表中的声明与“最终锁版本”。表内 catalog 已展开，解析版本取 workspace 的直接 importer，不能据此推断同名传递依赖只有一个版本。

| 包                             | 合并前声明            | 合并前直接版本 | 合并后声明            | 合并后直接版本 |
| ------------------------------ | --------------------- | -------------- | --------------------- | -------------- |
| `@cloudflare/vite-plugin`      | `catalog: → ^1.62.5`  | 1.62.5         | `catalog: → ^1.64.0`  | 1.64.0         |
| `@cloudflare/workers-types`    | `^5.20261003.1`       | 5.20261003.1   | `^5.20261014.1`       | 5.20261014.1   |
| `@codemirror/language`         | `^6.12.4`             | 6.12.4         | `^6.13.1`             | 6.13.1         |
| `@codemirror/view`             | `^6.43.13`            | 6.43.13        | `^6.43.14`            | 6.43.14        |
| `@hono/node-server`            | `catalog: → ^2.1.3`   | 2.1.3          | `catalog: → ^2.1.5`   | 2.1.5          |
| `@playwright/test`             | `^1.63.0`             | 1.63.0         | `^1.64.1`             | 1.64.1         |
| `@types/node`                  | `catalog: → ^24.19.1` | 24.19.1        | `catalog: → ^24.19.2` | 24.19.2        |
| `@vitejs/plugin-vue`           | `catalog: → ^6.0.9`   | 6.0.9          | `catalog: → ^6.0.10`  | 6.0.10         |
| `@vue/compiler-sfc`            | `^3.5.43`             | 3.5.43         | `^3.5.44`             | 3.5.44         |
| `drizzle-orm`                  | `^0.45.3`             | 0.45.3         | `^0.45.4`             | 0.45.4         |
| `execa`                        | `^10.0.1`             | 10.0.1         | `^10.1.1`             | 10.1.1         |
| `express`                      | `^5.2.1`              | 5.2.1          | `^5.3.0`              | 5.3.0          |
| `fastify`                      | `^5.12.5`             | 5.12.5         | `^5.12.7`             | 5.12.7         |
| `fastify-plugin`               | `^6.0.0`              | 6.0.0          | `^6.0.1`              | 6.0.1          |
| `hono`                         | `catalog: → ^4.13.12` | 4.13.12        | `catalog: → ^4.13.13` | 4.13.13        |
| `jsdom`                        | `^30.1.1`             | 30.1.1         | `^30.1.2`             | 30.1.2         |
| `rolldown`                     | `catalog: → 1.2.12`   | 1.2.12         | `catalog: → 1.2.14`   | 1.2.14         |
| `tsdown`                       | `catalog: → 0.23.0`   | 0.23.0         | `catalog: → 0.23.1`   | 0.23.1         |
| `turbo`                        | `^2.11.7`             | 2.11.7         | `^2.11.8`             | 2.11.8         |
| `vitepress-plugin-group-icons` | `^1.7.6`              | 1.7.6          | `^1.7.7`              | 1.7.7          |
| `vue`                          | `catalog: → ^3.5.43`  | 3.5.43         | `catalog: → ^3.5.44`  | 3.5.44         |
| `vue-i18n`                     | `^11.4.13`            | 11.4.13        | `^11.4.14`            | 11.4.14        |
| `vue-router`                   | `^5.3.1`              | 5.3.1          | `^5.4.0`              | 5.4.0          |
| `vue-tsc`                      | `catalog: → ^3.3.12`  | 3.3.12         | `catalog: → ^3.3.13`  | 3.3.13         |
| `wrangler`                     | `catalog: → ^4.147.0` | 4.147.0        | `catalog: → ^4.151.0` | 4.151.0        |

与 main 存在重叠时，保留本分支已验证的 Vite 8.3.5、Vitest/coverage-v8 5.0.5、markdown-it 14.3.3、VitePress 2.0.0-alpha.20 和 KaTeX 0.18.10；合并选择没有退回 main 的 Vite 8.3.4、Vitest 5.0.4、markdown-it 14.3.2、VitePress alpha.18，也没有引入 main 的 KaTeX 0.19 线。新网络 mock 功能的 interceptors、AJV、GraphQL、tough-cookie、YAML、字体、MSW facade 及所有新增导出/脚本均保留。

Node 下限提升不要求顺带更新所有剩余依赖。`@mswjs/interceptors 0.41.9`、`commander 14.0.3` 等保持已验证版本；原报告中“为了继续支持 Node 20”的理由仅作为历史决策背景，不再是当前消费者契约。

根 `release:check` 合并双方门禁：迁移守卫、行数守卫、release-tools、类型检查、构建、lint、单测、类型测试、串行 E2E、独立 D1 E2E、pack 检查和 mock package contract。构建完成后再 lint/测试。npmmirror scripts 与 afterPublish hook、D1 隔离测试、原有 provider/deployment/conformance 脚本同时保留。

## 安装治理、overrides 与锁解析

沿用 main 的 `minimumReleaseAge: 1440`、`strictDepBuilds`、`allowBuilds`、`gitChecks: false`，以及限定 `@pnpm/fs.find-packages@1000.0.24` 的 logger packageExtension。repoctl 5.10.3 checkpoint 补丁保留。首次以分支锁为解析起点时，旧锁中的 Rolldown 1.2.15 及其 bindings 尚不满足新增的 24 小时发布时间要求；随后以 main 锁为解析起点，结合合并后的 manifests/overrides 重新生成当前锁，安装和冻结锁校验成功，没有放宽 1440 分钟策略。`strictPeerDependencies` 仍为 false，因此安装成功不能代替显式 peer 检查。

关键 overrides 的选择如下；完整配置以 [pnpm-workspace.yaml](../../pnpm-workspace.yaml) 为准。选择器和目标范围不能理解成对所有历史上游 API 的兼容承诺，版本外观升级也不能代替行为验证。

| 选择器                                        | 目标范围/动作 | 本次边界                                                |
| --------------------------------------------- | ------------- | ------------------------------------------------------- |
| `vite@8.3.5>esbuild`                          | `0.28.2`      | 仅约束该 Vite 的可选转换器，不设置全局 esbuild override |
| `@icebreakers/monorepo@5.10.3>vitest`         | `~5.0.5`      | 与 coverage 插件的精确 peer 同步                        |
| `markdown-it@>=14.0.0 <14.3.3`                | `^14.3.3`     | 保留已审查的 14.x 安全下限                              |
| `katex@>=0.11.0 <0.18.2`                      | `~0.18.2`     | 实际 0.18.10；沿用合并前验证线，未扩大至 0.19           |
| `tinypool@>=2.0.0 <2.1.2`                     | `^2.2.0`      | 采用 main 下限，实际仍为 2.2.0                          |
| `launch-editor@<=2.14.1`                      | `^2.14.2`     | 保留编辑器参数相关安全下限                              |
| `proxy-addr@>=1.1.0 <2.0.8`                   | `^2.0.8`      | 当前实际为 2.0.8；未来若命中新的 1.x 上游需另审 API     |
| `sharp@>=0.35.0 <0.35.5`                      | `^0.35.5`     | 保持 0.35 版本线                                        |
| `source-map-js@>=1.0.0 <1.2.2`                | `^1.2.2`      | 保留源映射处理的安全下限                                |
| `@ungap/structured-clone@<1.3.1`              | `^1.3.1`      | 实际 1.4.0，不把下限写成安装版本                        |
| `@hono/node-server@>=1.0.0 <1.19.15`          | `^1.19.15`    | 更新 main 的 1.x floor；直接 catalog 走 2.1.5           |
| `hono@>=4.0.0 <4.13.13`                       | `^4.13.13`    | 与 main 的 4.x catalog 一致                             |
| `drizzle-kit@0.31.11>@esbuild-kit/esm-loader` | 删除该依赖    | 保留已有入口审查支持的稳定版 workaround                 |
| `drizzle-kit@0.31.11>tsx`                     | `^4.23.15`    | 保留稳定迁移格式，不转向 Drizzle 1.0 prerelease         |

主锁文档（pnpm 12 多文档锁中的业务依赖文档）统计：

| 指标           | 49a45a4 | 合并后 |
| -------------- | ------- | ------ |
| importers      | 21      | 21     |
| packages 条目  | 1962    | 1858   |
| snapshots 条目 | 1968    | 1859   |
| 不同包名       | 1672    | 1663   |

全部 manifest 的 dependencies/devDependencies/optionalDependencies specifier 与锁 importer 相符，catalog 的声明及解析范围也一致；外部直接依赖的实际版本满足相应声明范围。package 的 version 字段未变化。这里只报告静态一致性，不推导完整功能兼容性。

必须区分直接版本与整个锁树：

- workspace 直接 Vite 为 8.3.5，但 Docs → VitePress alpha.20 的传递图仍包含 Vite 8.3.4；相关 plugin-vue peer 也有 8.3.4 实例。
- esbuild 同时存在 0.25.12 与 0.28.2。0.25.12 是 Drizzle Kit 0.31.11 的直接依赖；定向 Vite override 不会覆盖它，删除旧 esm-loader 也不等于删除 Drizzle 自身的 esbuild。
- Rolldown 当前只解析为 1.2.14；Vitest/coverage-v8 都为 5.0.5。上述传递版本均须包含在合并后安全复核中，不能沿用“整棵树只有最新版本”的表述。

## 安全复核与剩余风险

合并后锁中的重点包实际版本如下。此表只核对锁解析，不替代当前 registry 公告的重新查询。

| 包                        | 合并后全部锁版本 |
| ------------------------- | ---------------- |
| `@simple-git/argv-parser` | 2.0.1            |
| `simple-git`              | 4.0.2            |
| `braces`                  | 3.0.3            |
| `katex`                   | 0.18.10          |
| `launch-editor`           | 2.14.2           |
| `markdown-it`             | 14.3.3           |
| `proxy-addr`              | 2.0.8            |
| `sharp`                   | 0.35.5           |
| `source-map-js`           | 1.2.2            |
| `sprintf-js`              | 不存在           |
| `tinypool`                | 2.2.0            |
| `@ungap/structured-clone` | 1.4.0            |

当前锁仍包含 braces 3.0.3。此次对合并后锁重新执行 pnpm audit 和 npm bulk 复核，两者均仅命中 [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 的 1 条 high；这是新锁的复核结果，不是沿用合并前快照。其余严重性均为 0，剩余告警没有被忽略或隐藏。

锁中的 deprecated 元数据现仅剩 `glob@11.1.0`，路径为 host SW demo → vite-plugin-pwa → workbox-build → glob。原锁的 `@types/parse-path@7.1.0` 已移除。Deprecated 提示与安全公告分别记录；没有使用跨主版本强行覆盖来隐藏剩余提示。

历史上 http-cache-semantics 的争议、缓存身份隔离要求和 Drizzle workaround 的审查依据继续参考 [依赖安全维护记录](../maintenance/dependency-security.md)。主锁变小或冻结安装通过都不能证明漏洞已经消失。

### 当前审计结果

2026-10-22 对当前合并锁执行 `pnpm audit --audit-level=moderate --json`，并用 npm bulk 对锁内全部 1,663 个不同包名复核：两种口径均为 1 条包—公告记录、1 个唯一 GHSA，high 1，critical/moderate/low 0。pnpm 的 moderate 门槛仍因该 high 不通过；这不是全绿审计。

公告元数据给出的受影响范围为 `<=3.0.3`，`patched_versions` 为 null，`patched_versions_unpublished` 为 true，没有据此填入一个不存在的可安装修复版本。当前典型路径包括：

- 根工具 → repoctl → @icebreakers/monorepo → micromatch → braces。
- Webpack demo → webpack-dev-server → http-proxy-middleware → micromatch → braces。
- 审计还列出 mokup 的 Webpack peer、Web demo 的 vue-router → unplugin → Webpack 路径；这些依赖图路径不能一概等同于所有消费者必需的生产依赖，但使用对应集成时仍应纳入风险判断。

触发点是将不可信的深层嵌套 brace pattern 传入同步解析，可能耗尽调用栈。维持由仓库配置控制 glob/proxy pattern 的边界；若以后接收外部 pattern，应在解析前限制长度和嵌套深度。普通 HTTP 请求本身不等于已到达该触发点。

本地复核证据为 [npm bulk 结果](/Users/icebreaker/.codex/artifacts/mokup-dependencies-2026-10-22/merge-main/audit-after.json) 与 [pnpm audit 日志](/Users/icebreaker/.codex/artifacts/mokup-dependencies-2026-10-22/merge-main/logs/audit.log)。两份证据都基于本次锁，包含传递 Vite 8.3.4 和 esbuild 0.25.12 的解析；不能从未命中公告推导这些包不存在风险。安装策略过程见 [首次安装拒绝记录](/Users/icebreaker/.codex/artifacts/mokup-dependencies-2026-10-22/merge-main/logs/install.log)、[按 main 锁重新解析记录](/Users/icebreaker/.codex/artifacts/mokup-dependencies-2026-10-22/merge-main/logs/install-merged.log) 和 [冻结锁安装记录](/Users/icebreaker/.codex/artifacts/mokup-dependencies-2026-10-22/merge-main/logs/frozen-install.log)。

## 合并后的验证结果

环境为 macOS / Apple Silicon、Node 24.18.0、pnpm 12.11.2。以下均对当前合并结果实际执行；Turbo 设置 `TURBO_FORCE=true`，typecheck、workspace lint、build、串行 E2E 的缓存命中均为 0。运行日志、完整命令及退出码保存在本地证据目录的 `results.jsonl` 和 `logs/` 中。

| 范围           | 执行与结果                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 依赖健康       | 冻结锁安装、`pnpm peers check`、repo doctor（26 项）、对已暂存合并文件执行的 repo check 通过；安全审计仍有上文 1 条 high，退出 1        |
| 迁移与规模门禁 | migration guard 核对 20 个 workspace manifest；500 行硬门禁通过，11 项超过 300 行的软告警保留                                           |
| 发布工具       | 8 项 release-tools 回归通过；repoctl checkpoint 补丁与 main 一致                                                                        |
| 静态质量       | typecheck 27 个任务、workspace lint 20 个任务通过；根 ESLint 0 errors、15 条已有依赖替代建议 warnings                                   |
| 构建           | 17 个任务通过，覆盖发布包、全部有构建入口的 demo 与文档                                                                                 |
| 单元与覆盖率   | 278 个文件通过、1 个文件跳过；2,041 passed、1 个已有 Windows 专属 skip、1 个已有 todo，共 2,043 项                                      |
| 类型与产物     | 9 个包的 tsd 通过；10 个发布包 pack 与 mock package contract 通过                                                                       |
| 适配与示例     | Fetch/Worker/Hono/Next/Astro provider matrix、6 个本地 deployment template 契约、network demo 的 HTTP/GraphQL/场景切换/录制回放断言通过 |
| Vite           | 5.0.0、5.4.21、6.0.0、6.4.1、7.0.0、7.3.6、8.0.0、8.3.2、8.3.5 全部通过，每版 360 次 fresh load                                         |
| 浏览器         | 根目录和 9 个 app 的串行 E2E 共 90 项通过；Chrome/Firefox/WebKit conformance 共 45 项通过                                               |
| D1             | 隔离的本地 D1 认证/账号/用户请求 E2E 1 项通过；使用本地数据库与随机测试端口                                                             |
| Node consumer  | Node 22.12.0、24.18.0 的 10 个 tarball 隔离安装及执行均通过                                                                             |
| 发布预览       | `pnpm exec repo release plan` 通过；沿用 main 的 Node 下限 major 意图及本分支功能/修复意图，没有运行 version、publish 或同步            |

覆盖率为 Statements 86.97%、Lines 87.16%、Functions 88.43%、Branches 79.37%。原阈值分别为 85%、85%、85%、75%，未放宽。Node consumer 在严格 engines 安装后，验证打包入口、CLI、TypeScript bundle、Fetch/HTTP/WebSocket，并继续运行完整兼容脚本，覆盖 115 个导出及网络拦截、请求/响应语义、模块刷新等运行场景。合并前的 Node 20 测试仅为历史证据，当前不再承诺该版本。

### 合并后发现并修复的验证问题

main 的 consumer 脚本假定发布包固定为 9 个，现改为精确核对全部 10 个包名，包含新增的 `@mokup/msw`。WebSocket smoke 原先假定 snapshot 后第一条消息就是请求计数；新功能会在 increment 前发送请求诊断，因此初次 Node 22/24 执行失败。读取逻辑现持续处理同一消息流，在原有 10 秒期限内校验诊断并等待 increment，仍严格断言 `GET /ping`、计数 1、成功响应及 `response:mocked` 诊断；坏 JSON、异常诊断、连接错误和提前关闭继续失败。未增加超时或重试，也未修改生产协议来适配旧测试。

全部浏览器测试后台串行运行，由同一执行者管理。测试前后核对 287 个 fixture/mock 文件，内容哈希全部一致；任务测试服务与浏览器已退出，5173/5174 端口空闲，没有关闭其他任务或用户原有浏览器。

本报告的执行结果只覆盖当前 macOS。Linux、Windows 的检查由 PR CI 另行报告，在收到本次提交对应的成功结果前不标记通过；部署模板结果仅代表本地契约验证。当前明确剩余项是没有可用上游修复版的 braces high 公告，以及待 CI 验证的平台结果。
