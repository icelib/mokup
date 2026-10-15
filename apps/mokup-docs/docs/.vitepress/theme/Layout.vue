<script setup lang="ts">
import { withBase } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import BrandLogo from './components/BrandLogo.vue'

const { Layout: DefaultLayout } = DefaultTheme
</script>

<template>
  <DefaultLayout>
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
