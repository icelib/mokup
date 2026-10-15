# Diagnostics

当 Mokup 扫描到不能正常作为路由使用的文件或规则时，会产出诊断信息。默认情况下，
这些诊断会以 warning 和摘要的形式输出。你可以通过 `errorOn` 把指定诊断升级成
构建失败或启动失败。

使用 `mokup check --json` 可在不生成构建产物的情况下获取诊断报告。默认所有路由诊断都会导致检查失败，可用 `--error-on` 缩小失败范围。详见 [CLI check](./cli.md#check)。

## 支持的类别

| 类别                 | 含义                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `invalid-route`      | 文件无法被解析成合法的路由路径或方法。                                        |
| `unsupported-fields` | 规则仍然使用了 `response`、`url`、`method` 等旧字段。                         |
| `missing-handler`    | 已启用的规则没有提供 `handler`。                                              |
| `duplicate-route`    | 多个文件或规则最终解析成相同的 `METHOD + path`。                              |
| `sw-conflict`        | 多个 SW entry 在 `sw.path`、`sw.scope`、`register`、`unregister` 上配置冲突。 |

## `errorOn`

Mokup 现在各个主要入口都使用同一套 `errorOn` 形状：

```ts
type DiagnosticErrorMode = 'all' | DiagnosticCategory[]
```

使用场景：

- 本地开发先保持宽松，但在 CI 中遇到坏路由文件直接失败。
- 迁移阶段允许部分 mock 未完成，同时阻止重复路由进入主干。
- 多个 SW entry 并存时，强制要求 service worker 配置一致。

示例：

```ts
import mokup from 'mokup/vite'

export default {
  plugins: [
    mokup({
      errorOn: ['invalid-route', 'duplicate-route', 'sw-conflict'],
      entries: { dir: 'mock', prefix: '/api', mode: 'sw' },
    }),
  ],
}
```

如果希望所有支持的类别都直接失败，可以使用 `errorOn: 'all'`。

## 各入口支持情况

| 入口                       | 是否支持 `errorOn` | 说明                                       |
| -------------------------- | ------------------ | ------------------------------------------ |
| `buildManifest(...)`       | 是                 | 覆盖 manifest 路由扫描诊断。               |
| `mokup build --error-on`   | 是                 | `buildManifest(...)` 的 CLI 封装。         |
| Vite 插件 `mokup(...)`     | 是                 | 覆盖路由诊断和 SW 配置冲突。               |
| `createWebpackPlugin(...)` | 是                 | 覆盖路由诊断和 SW 配置冲突。               |
| `createFetchServer(...)`   | 是                 | 在独立服务启动时对命中的路由诊断直接失败。 |
| `mokup serve --error-on`   | 是                 | `createFetchServer(...)` 的 CLI 封装。     |

说明：

- `sw-conflict` 只会出现在 Vite 和 webpack 插件的 SW entry 场景。
- CLI manifest 和 fetch server 为了类型一致性接受同样的类别形状，但它们自身不会产出
  service worker 冲突诊断。

## 行为细节

当 `errorOn` 命中某个类别时：

- Mokup 仍然会先组装同样的诊断摘要文本。
- 该摘要会以 `Error` 抛出，而不再只是 warning。
- 进程会在构建或启动阶段直接失败，而不是继续向下执行。

当 `errorOn` 没命中时：

- 诊断仍然只是 warning。
- 路由扫描会尽可能继续。
- 仍然有效的路由会继续被加载。

## Shared helpers

如果你在 Mokup 之上继续封装工具，建议直接复用
`@mokup/shared/diagnostics` 提供的 helper，而不是自己重新拼装摘要和严格模式逻辑。

```ts
import {
  collectRouteDiagnosticWarning,
  createRouteDiagnosticSections,
  reportDiagnostics,
} from '@mokup/shared/diagnostics'

const unsupportedFields = new Set<string>()
const missingHandlers = new Set<string>()
const duplicateRoutes = new Set<string>()

collectRouteDiagnosticWarning({
  message: 'Skip mock without handler: mock/users.get.ts',
  onUnsupportedFields: value => unsupportedFields.add(value),
  onMissingHandler: value => missingHandlers.add(value),
  onDuplicateRoute: value => duplicateRoutes.add(value),
})

const diagnostics = createRouteDiagnosticSections({
  unsupportedFields: [...unsupportedFields],
  missingHandlers: [...missingHandlers],
  duplicateRoutes: [...duplicateRoutes],
})

const { error, summaryLines } = reportDiagnostics({
  sections: diagnostics,
  errorOn: ['missing-handler'],
})
```

如果要处理 service worker 冲突，也可以按同样方式使用
`collectSwConflictDiagnosticWarning(...)` 和
`createSwConflictDiagnosticSections(...)`。

## 推荐用法

- 如果想低风险启用严格模式，先从 `['duplicate-route']` 开始。
- 然后再加上 `invalid-route` 和 `missing-handler`，能拦住最常见的书写错误。
- 只要有多个 SW entry，就建议打开 `sw-conflict`。
- `'all'` 更适合已经清理过历史 mock 的仓库，或直接用于 CI。
