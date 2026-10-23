<script setup lang="ts">
import type { DocsThemeConfig } from '../deployment'
import { useData, withBase } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import BrandLogo from './components/BrandLogo.vue'

const { Layout: DefaultLayout } = DefaultTheme
const { lang, theme } = useData<DocsThemeConfig>()
</script>

<template>
  <DefaultLayout :class="{ 'mokup-preview-layout': theme.docsPreview }">
    <template v-if="theme.docsPreview" #layout-top>
      <div class="mokup-preview-banner" role="note">
        <span>{{ lang.startsWith('zh') ? '未发布文档 · 内容可能与当前正式版本不同。' : 'Unreleased documentation · Content may differ from the current stable version.' }}</span>
        <a :href="`${theme.stableUrl}${lang.startsWith('zh') ? '/zh/' : '/'}`">
          {{ lang.startsWith('zh') ? '查看正式文档' : 'Read stable docs' }}
        </a>
      </div>
    </template>
    <template #nav-bar-title>
      <a class="mokup-brand-link" :href="withBase('/')">
        <BrandLogo size="small" />
      </a>
    </template>
    <template #home-hero-image>
      <div class="mokup-hero-logo">
        <BrandLogo size="large" :showText="false" />
      </div>
    </template>
  </DefaultLayout>
</template>
