# CLI

`mokup` 提供 `check`、`build` 与 `serve` 三个命令。

## Check

在提交代码前或 CI 中校验 mock 路由，无需生成 `.mokup` 文件或启动服务器：

```sh
pnpm exec mokup check --dir mock
pnpm exec mokup check --dir mock --json
pnpm exec mokup check --dir mock --error-on duplicate-route
```

`check` 与 `build` 共用目录配置、路由发现和过滤规则，支持 `--dir`、`--root`、`--prefix`、`--include`、`--exclude`、`--ignore-prefix` 和可重复的 `--error-on`。函数 handler 会计入路由数量，但不会被调用。加载文件时仍会执行模块顶层代码及目录配置 hooks。

默认情况下，所有支持的路由诊断都会使检查失败。使用 `--error-on` 可以只让指定类别导致失败，报告仍包含全部诊断。已存在的空目录，或路由全部被过滤、禁用的目录，以零路由通过检查。目录不存在、选中的 JSON/JSONC 文件无效、模块加载出错时检查失败。该命令不执行 TypeScript 类型检查，也不调用请求中间件。

退出码 `0` 表示通过，`1` 表示诊断命中错误策略或扫描失败。`--json` 将单条报告写入 stdout，代替 Mokup 日志：

```json
{
  "schemaVersion": 1,
  "valid": true,
  "routeCount": 2,
  "diagnostics": []
}
```

诊断项包含 `category`、`label`、`count`、`items` 和可选的 `advice`。文件路径相对于项目根目录。扫描失败时，报告额外包含 `error.message`，并返回 `valid: false`、`routeCount: 0` 和空诊断数组。消费 JSON 报告时，请避免 mock 模块自己的 console 输出写入 stdout。

也可以通过 API 校验：

```ts
import { checkManifest } from 'mokup/cli'

const result = await checkManifest({
  dir: 'mock',
  errorOn: ['duplicate-route'],
})

if (!result.valid) {
  console.error(result.diagnostics)
}
```

`checkManifest()` 默认使用 `errorOn: 'all'`；传入 `errorOn: []` 只返回诊断，不因诊断而失败。目录不存在或模块导入失败等扫描错误会使 Promise reject。该 API 不接受输出目录或 handler 打包选项。

## Build

生成供服务端适配器与 Worker 使用的 `.mokup` 构建产物。

使用场景：

- 为 Worker 或服务端运行时生成 bundle。
- 在 CI/CD 中预构建 mock 产物。

示例：

::: code-group

```bash [pnpm]
pnpm exec mokup build --dir mock --out .mokup
```

```bash [npm]
npm exec mokup build --dir mock --out .mokup
```

```bash [yarn]
yarn mokup build --dir mock --out .mokup
```

```bash [bun]
bunx mokup build --dir mock --out .mokup
```

:::

### Build 选项

| 参数              | 说明                               |
| ----------------- | ---------------------------------- |
| `--dir, -d`       | mock 目录（可重复）                |
| `--out, -o`       | 输出目录（默认 `.mokup`）          |
| `--prefix`        | 路由前缀                           |
| `--include`       | 仅包含匹配的正则（可重复）         |
| `--exclude`       | 排除匹配的正则（可重复）           |
| `--ignore-prefix` | 忽略路径段前缀（可重复）           |
| `--error-on`      | 指定命中后直接失败的诊断（可重复） |
| `--no-handlers`   | 不生成函数处理器                   |

## Serve

从目录直接启动独立的 mock 服务。

使用场景：

- 不依赖前端应用，快速起一个 mock API 服务。
- 用于本地联调或接口测试。

示例：

::: code-group

```bash [pnpm]
pnpm exec mokup serve --dir mock --prefix /api --port 3000
```

```bash [npm]
npm exec mokup serve --dir mock --prefix /api --port 3000
```

```bash [yarn]
yarn mokup serve --dir mock --prefix /api --port 3000
```

```bash [bun]
bunx mokup serve --dir mock --prefix /api --port 3000
```

:::

### Serve 选项

| 参数              | 说明                                   |
| ----------------- | -------------------------------------- |
| `--dir, -d`       | mock 目录（可重复）                    |
| `--prefix`        | 路由前缀                               |
| `--include`       | 仅包含匹配的正则（可重复）             |
| `--exclude`       | 排除匹配的正则（可重复）               |
| `--ignore-prefix` | 忽略路径段前缀（可重复）               |
| `--error-on`      | 指定命中后启动直接失败的诊断（可重复） |
| `--host`          | 主机名（默认 `localhost`）             |
| `--port`          | 端口（默认 `8080`）                    |
| `--no-watch`      | 关闭文件监听                           |
| `--no-playground` | 关闭 Playground                        |
| `--no-log`        | 关闭日志输出                           |

## API

如果更喜欢编程式用法，可直接调用 `buildManifest`：

使用场景：

- 在 Node 脚本或构建管线中生成 manifest。
- 集成到自定义工具链。

示例：

```ts
import { buildManifest } from 'mokup/cli'

await buildManifest({
  dir: 'mock',
  outDir: '.mokup',
  errorOn: ['invalid-route', 'missing-handler'],
})
```

### 严格诊断

`buildManifest(...)` 也支持同样的诊断升级能力。

支持的类别：

- `invalid-route`
- `unsupported-fields`
- `missing-handler`
- `duplicate-route`
- `sw-conflict`

如果希望所有支持的诊断都直接抛错，可使用 `errorOn: 'all'`。在 CLI 的
manifest 构建里，`sw-conflict` 主要用于类型对齐；当前真正会产出的仍然是
路由扫描相关诊断。

### Bundle helper（跨平台）

生成 bundle 模块源码字符串，不依赖文件系统：

使用场景：

- 在无文件系统的环境中生成 bundle 源码。
- 自定义模块 import 路径输出。

示例：

```ts
import type { RouteTable } from 'mokup/bundle'
import { buildBundleModule } from 'mokup/bundle'

const routes: RouteTable = []
const source = buildBundleModule({
  routes,
  root: '/project',
  resolveModulePath: file => `/virtual/${file}`,
})
```

`routes` 的结构与 `scanRoutes`（来自 `mokup/vite`）的返回值一致。若不在 Vite
环境内构建，请用 `resolveModulePath` 控制输出的 import 路径。

## 说明

- `--dir` 可多次传入，但会在同一份 manifest 中合并。
- 生成的 `mokup.bundle.mjs` 适合在 Worker 或 Node 运行时直接导入。
- `mokup serve` 与内置服务直启行为一致。
