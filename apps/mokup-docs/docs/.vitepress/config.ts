import type { DefaultTheme, HeadConfig, MarkdownRenderer, UserConfig } from 'vitepress'
import type { DocsThemeConfig } from './deployment'
import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import mokup from 'mokup/vite'
import { defineConfig } from 'vitepress'
import { groupIconMdPlugin, groupIconVitePlugin } from 'vitepress-plugin-group-icons'
import llmstxt from 'vitepress-plugin-llms'
import { writeDeploymentFiles } from '../../../../scripts/docs-deployment/output.mjs'
import { enNav, zhNav } from './config/nav'
import { enSidebar, zhSidebar } from './config/sidebar'
import { getDocsDeployment } from './deployment'
import { isolateWorkerChunks } from './plugins/worker-chunks'

const siteTitle = 'Mokup'
const siteTagline = 'File-based HTTP framework for Vite, Node, and Workers'
const siteDescription
  = 'Build file-driven HTTP routes with a unified runtime, serving mock or real APIs across dev and deployment.'
const deployment = getDocsDeployment(process.env['REPO_DOCS_CHANNEL'])
const siteUrl = deployment.origin
const ogImage = `${siteUrl}/brand/mokup-logo.svg`
const isProductionBuild = process.env['NODE_ENV'] === 'production' || process.argv.includes('build')
const zhNavWithDraftPreview: DefaultTheme.NavItem[] = isProductionBuild
  ? zhNav
  : [...zhNav, { text: '草稿预览', link: '/zh/blog/drafts' }]

const themeConfig: DocsThemeConfig = {
  docsPreview: deployment.preview,
  stableUrl: deployment.stableUrl,
  socialLinks: [
    { icon: 'github', link: 'https://github.com/icelib/mokup' },
  ],
  nav: enNav,
  sidebar: enSidebar,
  outline: { label: 'On this page' },
}

const vitePlugins = [
  isolateWorkerChunks(),
  tailwindcss(),
  mokup({
    entries: {
      dir: '../mock',
      prefix: '/api',
      mode: 'sw',
    },
    playground: {
      build: true,
    },
  }),
  groupIconVitePlugin(),
  llmstxt({
    domain: siteUrl,
    generateLLMsTxt: true,
    generateLLMsFullTxt: true,
    generateLLMFriendlyDocsForEachPage: true,
    excludeBlog: false,
    ignoreFiles: ['**/*.zh-draft.md', 'zh/blog/drafts.md'],
    customTemplateVariables: {
      title: `${siteTitle} Documentation`,
      description: siteDescription,
      details: [
        '- Bilingual docs: English + Simplified Chinese.',
        '- Full bundle: /llms-full.txt.',
        '- AI prompt templates: /ai/.',
      ].join('\n'),
    },
    customLLMsTxtTemplate: [
      '# {title}',
      '',
      '> {description}',
      '',
      '{details}',
      '',
      '## Table of Contents',
      '',
      '{toc}',
      '',
    ].join('\n'),
  }),
]

const head: HeadConfig[] = [
  ['link', { rel: 'icon', href: '/favicon.ico' }],
  [
    'meta',
    {
      name: 'keywords',
      content:
        'Mokup, HTTP framework, file-based routing, API, mock, Vite, Node, Worker, middleware, runtime',
    },
  ],
  ['meta', { property: 'og:site_name', content: siteTitle }],
  ['meta', { property: 'og:type', content: 'website' }],
  [
    'meta',
    { property: 'og:title', content: `${siteTitle} — ${siteTagline}` },
  ],
  ['meta', { property: 'og:description', content: siteDescription }],
  ['meta', { property: 'og:image', content: ogImage }],
  ['meta', { property: 'og:locale', content: 'en_US' }],
  ['meta', { property: 'og:locale:alternate', content: 'zh_CN' }],
  ['meta', { name: 'twitter:card', content: 'summary' }],
  [
    'meta',
    { name: 'twitter:title', content: `${siteTitle} — ${siteTagline}` },
  ],
  ['meta', { name: 'twitter:description', content: siteDescription }],
  ['meta', { name: 'twitter:image', content: ogImage }],
]

const docsConfig: UserConfig<DocsThemeConfig> = {
  title: siteTitle,
  description: siteDescription,
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  head,
  transformHead({ pageData }) {
    const pathname = pageData.relativePath.replace(/(?:^|\/)index\.md$/, '/').replace(/\.md$/, '')
    const url = new URL(pathname, `${siteUrl}/`).href
    const pageHead: HeadConfig[] = [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:url', content: url }],
    ]
    if (deployment.preview) {
      pageHead.push(['meta', { name: 'robots', content: 'noindex, nofollow' }])
    }
    return pageHead
  },
  buildEnd: config => writeDeploymentFiles(config.outDir, deployment),
  vite: {
    build: {
      chunkSizeWarningLimit: 800,
    },
    plugins: vitePlugins,
  },
  ...(deployment.preview ? {} : { sitemap: { hostname: siteUrl } }),
  locales: {
    root: { label: 'English', lang: 'en-US' },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      description:
        '面向 Vite、Node 与 Worker 的文件式 HTTP 框架，统一运行时，覆盖 Mock 到真实 API 的完整流程。',
      themeConfig: {
        nav: zhNavWithDraftPreview,
        sidebar: zhSidebar,
        outline: { label: '本页目录' },
      },
    },
  },
  themeConfig,
  markdown: {
    config(md: MarkdownRenderer) {
      md.use(groupIconMdPlugin)
    },
  },
}

const finalConfig: UserConfig<DocsThemeConfig> = {
  ...docsConfig,
}
if (isProductionBuild) {
  finalConfig.srcExclude = ['**/*.zh-draft.md', 'zh/blog/drafts.md']
}

export default defineConfig<DocsThemeConfig>(finalConfig)
