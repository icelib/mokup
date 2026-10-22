import type { DefaultTheme } from 'vitepress'

export const zhSidebar: DefaultTheme.Sidebar = {
  '/zh/': [
    {
      text: '开始使用',
      collapsed: false,
      items: [
        { text: '项目概览', link: '/zh/getting-started/overview' },
        { text: '安装', link: '/zh/getting-started/installation' },
        { text: '升级到 v1', link: '/zh/getting-started/upgrade-to-v1' },
        { text: '快速开始', link: '/zh/getting-started/quick-start/' },
        { text: 'Vite 快速开始', link: '/zh/getting-started/quick-start/vite' },
        { text: 'Webpack 快速开始', link: '/zh/getting-started/quick-start/webpack' },
        { text: 'Node.js API', link: '/zh/getting-started/node-api' },
        { text: '服务端中间件', link: '/zh/getting-started/server-middleware' },
        { text: 'Cloudflare', link: '/zh/getting-started/cloudflare' },
      ],
    },
    {
      text: '核心概念',
      collapsed: false,
      items: [
        { text: '文件路由', link: '/zh/core-concepts/file-routing' },
        { text: 'Mock 规则', link: '/zh/core-concepts/mock-rules' },
        { text: '函数处理器', link: '/zh/core-concepts/handlers' },
        { text: 'Manifest', link: '/zh/core-concepts/manifest' },
        { text: 'Bundle', link: '/zh/core-concepts/bundle' },
      ],
    },
    {
      text: '进阶',
      collapsed: false,
      items: [
        { text: '多目录与前缀', link: '/zh/advanced/multi-dir-prefix' },
        { text: 'Playground', link: '/zh/advanced/playground' },
        { text: '网络 Mock 与迁移', link: '/zh/advanced/network-mocking' },
        { text: 'HTTP Handler', link: '/zh/reference/http-handlers' },
        { text: 'WebSocket', link: '/zh/reference/websocket' },
        { text: '诊断与插件', link: '/zh/reference/extensions' },
        { text: '可选集成', link: '/zh/reference/integrations' },
        { text: '中间件顺序', link: '/zh/advanced/middleware-ordering' },
        { text: '热更新与调试', link: '/zh/advanced/hot-reload' },
      ],
    },
    {
      text: '部署',
      collapsed: false,
      items: [
        { text: 'Vite 构建产物', link: '/zh/deploy/vite-build' },
        { text: 'Cloudflare Worker', link: '/zh/deploy/cloudflare-worker' },
      ],
    },
    {
      text: '平台',
      collapsed: false,
      items: [
        { text: '跨运行时 JavaScript', link: '/zh/platform/cross-runtime-js' },
      ],
    },
  ],
  '/zh/ai/': [
    {
      text: 'AI 提示词',
      collapsed: false,
      items: [
        { text: '概览', link: '/zh/ai/' },
        { text: 'DTS 模板', link: '/zh/ai/prompt-templates-dts' },
        { text: 'OpenAPI 模板', link: '/zh/ai/prompt-templates-openapi' },
        { text: 'llms.txt', link: '/zh/ai/llms-txt' },
      ],
    },
  ],
  '/zh/blog/': [
    {
      text: '博客',
      collapsed: false,
      items: [
        { text: 'Mokup：一个统一运行时的 Mock 库', link: '/zh/blog/mokup-unified-mock-library' },
      ],
    },
  ],
  '/zh/reference/': [
    {
      text: '参考',
      collapsed: false,
      items: [
        { text: 'CLI', link: '/zh/reference/cli' },
        { text: 'Diagnostics', link: '/zh/reference/diagnostics' },
        { text: '框架适配器', link: '/zh/reference/frameworks' },
        { text: 'Vite 插件', link: '/zh/reference/vite-plugin' },
        { text: 'Webpack 插件', link: '/zh/reference/webpack-plugin' },
        { text: 'Server 适配器', link: '/zh/reference/server' },
        { text: 'Runtime API', link: '/zh/reference/runtime' },
        { text: 'Manifest 结构', link: '/zh/reference/manifest-schema' },
        { text: '常见问题', link: '/zh/reference/faq' },
      ],
    },
  ],
}

export const enSidebar: DefaultTheme.Sidebar = {
  '/': [
    {
      text: 'Getting Started',
      collapsed: false,
      items: [
        { text: 'Overview', link: '/getting-started/overview' },
        { text: 'Installation', link: '/getting-started/installation' },
        { text: 'Upgrade to v1', link: '/getting-started/upgrade-to-v1' },
        { text: 'Quick Start', link: '/getting-started/quick-start/' },
        { text: 'Vite Quick Start', link: '/getting-started/quick-start/vite' },
        { text: 'Webpack Quick Start', link: '/getting-started/quick-start/webpack' },
        { text: 'Node.js API', link: '/getting-started/node-api' },
        { text: 'Server Middleware', link: '/getting-started/server-middleware' },
        { text: 'Cloudflare', link: '/getting-started/cloudflare' },
      ],
    },
    {
      text: 'Core Concepts',
      collapsed: false,
      items: [
        { text: 'File Routing', link: '/core-concepts/file-routing' },
        { text: 'Mock Rules', link: '/core-concepts/mock-rules' },
        { text: 'Handlers', link: '/core-concepts/handlers' },
        { text: 'Manifest', link: '/core-concepts/manifest' },
        { text: 'Bundle', link: '/core-concepts/bundle' },
      ],
    },
    {
      text: 'Advanced',
      collapsed: false,
      items: [
        { text: 'Multi-Dir & Prefix', link: '/advanced/multi-dir-prefix' },
        { text: 'Playground', link: '/advanced/playground' },
        { text: 'Network Mocking & Migration', link: '/advanced/network-mocking' },
        { text: 'HTTP Handlers', link: '/reference/http-handlers' },
        { text: 'WebSocket', link: '/reference/websocket' },
        { text: 'Diagnostics & Plugins', link: '/reference/extensions' },
        { text: 'Optional Integrations', link: '/reference/integrations' },
        { text: 'Middleware Ordering', link: '/advanced/middleware-ordering' },
        { text: 'Hot Reload & Debug', link: '/advanced/hot-reload' },
      ],
    },
    {
      text: 'Deploy',
      collapsed: false,
      items: [
        { text: 'Vite Build Output', link: '/deploy/vite-build' },
        { text: 'Cloudflare Worker', link: '/deploy/cloudflare-worker' },
      ],
    },
    {
      text: 'Platform',
      collapsed: false,
      items: [
        { text: 'Cross-Runtime JavaScript', link: '/platform/cross-runtime-js' },
      ],
    },
  ],
  '/ai/': [
    {
      text: 'AI Prompts',
      collapsed: false,
      items: [
        { text: 'Overview', link: '/ai/' },
        { text: 'DTS Templates', link: '/ai/prompt-templates-dts' },
        { text: 'OpenAPI Templates', link: '/ai/prompt-templates-openapi' },
        { text: 'llms.txt', link: '/ai/llms-txt' },
      ],
    },
  ],
  '/blog/': [
    {
      text: 'Blog',
      collapsed: false,
      items: [
        { text: 'Mokup: A Unified Runtime Mock Library', link: '/blog/mokup-unified-mock-library' },
      ],
    },
  ],
  '/reference/': [
    {
      text: 'Reference',
      collapsed: false,
      items: [
        { text: 'CLI', link: '/reference/cli' },
        { text: 'Diagnostics', link: '/reference/diagnostics' },
        { text: 'Framework Adapters', link: '/reference/frameworks' },
        { text: 'Vite Plugin', link: '/reference/vite-plugin' },
        { text: 'Webpack Plugin', link: '/reference/webpack-plugin' },
        { text: 'Server Adapters', link: '/reference/server' },
        { text: 'Runtime API', link: '/reference/runtime' },
        { text: 'Manifest Schema', link: '/reference/manifest-schema' },
        { text: 'FAQ', link: '/reference/faq' },
      ],
    },
  ],
}
