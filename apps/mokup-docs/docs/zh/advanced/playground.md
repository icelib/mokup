# Playground

Playground 是一个内置的可视化面板，用于浏览和调试当前已加载的 mock 接口。

## 默认入口

```
http://localhost:5173/__mokup
```

## 配置入口

```ts
import mokup from 'mokup/vite'

export default {
  plugins: [
    mokup({
      entries: {
        dir: 'mock',
        prefix: '/api',
      },
      playground: {
        path: '/__mokup',
        enabled: true,
      },
    }),
  ],
}
```

当 `playground: false` 时将禁用。

需要静态部署时，可设置 `playground.build: true`，在 `vite build` 中输出
Playground 资源与 `/__mokup/routes` JSON 到对应路径。

## 功能

- 按目录/分组展示路由
- 查看请求方法、路径与响应类型
- 与 Vite 热更新联动，文件变更会刷新路由
- 将请求复制为 cURL 命令或 Fetch 代码，包含查询参数、认证、请求头和文本请求体

## 复制请求

选中路由并配置请求后，使用 **复制 → 复制 cURL** 或 **复制 → 复制 fetch**。两种格式都使用 Playground 当前的主机和端口，保留原始文本、URL 编码字段及 multipart 文本字段的值；以 `@` 开头的原始文本在 cURL 中仍按文本发送。

cURL 命令使用 POSIX shell 引号规则，可在 Bash、Zsh 或 Git Bash 中执行。复制的代码不包含已选择的文件，需要在目标客户端中另行添加。
