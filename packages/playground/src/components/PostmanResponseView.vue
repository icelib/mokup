<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import RequestTimeline from './RequestTimeline.vue'

type ResponseTab = 'body' | 'headers' | 'cookies' | 'history'
type BodyView = 'pretty' | 'raw' | 'preview'

const props = defineProps<{
  responseRaw: string
  responsePretty: string
  responseHeaders: Record<string, string>
  responseContentType: string
  responseStatus: string
  responseTime: string
}>()

const { t } = useI18n()
const activeTab = ref<ResponseTab>('body')
const bodyView = ref<BodyView>('pretty')

const responseStatusLabel = computed(() => props.responseStatus || t('response.idle'))
const responseTimeLabel = computed(() => props.responseTime || t('response.waiting'))
const responseSizeLabel = computed(() => {
  const text = props.responseRaw ?? ''
  if (!text) {
    return t('response.size', { size: '0 B' })
  }
  const bytes = typeof TextEncoder === 'undefined'
    ? text.length
    : new TextEncoder().encode(text).length
  const size = bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return t('response.size', { size })
})
const responsePretty = computed(() => props.responsePretty || t('response.empty'))
const responseRaw = computed(() => props.responseRaw || props.responsePretty || t('response.empty'))
const headerEntries = computed(() => Object.entries(props.responseHeaders))
const hasPreview = computed(() => props.responseContentType.toLowerCase().includes('text/html'))
const previewContent = computed(() => props.responseRaw || props.responsePretty)

watch(hasPreview, (value) => {
  if (!value && bodyView.value === 'preview') {
    bodyView.value = 'pretty'
  }
})
</script>

<template>
  <section class="flex min-h-[240px] flex-1 flex-col rounded border border-pg-border bg-pg-surface-card">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-[0.65rem] tracking-[0.08em] border-pg-border text-pg-text-muted">
      <span>{{ t('detail.responseLabel') }}</span>
      <span class="flex flex-wrap items-center gap-3 text-[0.65rem] normal-case tracking-normal text-pg-text-subtle">
        <span>{{ responseStatusLabel }}</span>
        <span>{{ responseTimeLabel }}</span>
        <span>{{ responseSizeLabel }}</span>
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-4 border-b px-4 pt-2 text-[0.65rem] tracking-[0.1em] border-pg-border" role="tablist">
      <button type="button" role="tab" :aria-selected="activeTab === 'history'" class="border-b-2 pb-2 transition" :class="activeTab === 'history' ? 'border-pg-accent text-pg-text-strong' : 'border-transparent text-pg-text-muted hover:text-pg-text-soft'" @click="activeTab = 'history'">
        {{ t('response.historyTab') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'body'"
        class="border-b-2 pb-2 transition"
        :class="activeTab === 'body'
          ? 'border-pg-accent text-pg-text-strong'
          : 'border-transparent text-pg-text-muted hover:text-pg-text-soft'"
        @click="activeTab = 'body'"
      >
        {{ t('response.bodyTab') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'headers'"
        class="border-b-2 pb-2 transition"
        :class="activeTab === 'headers'
          ? 'border-pg-accent text-pg-text-strong'
          : 'border-transparent text-pg-text-muted hover:text-pg-text-soft'"
        @click="activeTab = 'headers'"
      >
        {{ t('response.headersTab') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'cookies'"
        class="border-b-2 pb-2 transition"
        :class="activeTab === 'cookies'
          ? 'border-pg-accent text-pg-text-strong'
          : 'border-transparent text-pg-text-muted hover:text-pg-text-soft'"
        @click="activeTab = 'cookies'"
      >
        {{ t('response.cookiesTab') }}
      </button>
    </div>

    <div class="flex-1 min-h-0 overflow-auto p-4">
      <RequestTimeline v-if="activeTab === 'history'" />
      <div v-else-if="activeTab === 'body'" class="flex h-full flex-col gap-3">
        <div class="flex flex-wrap items-center gap-3 text-[0.6rem] tracking-[0.1em] text-pg-text-muted">
          <button
            type="button"
            class="rounded border px-3 py-1 transition border-pg-border"
            :class="bodyView === 'pretty' ? 'bg-pg-hover text-pg-text-strong' : 'text-pg-text-muted hover:text-pg-text-soft'"
            @click="bodyView = 'pretty'"
          >
            {{ t('response.prettyTab') }}
          </button>
          <button
            type="button"
            class="rounded border px-3 py-1 transition border-pg-border"
            :class="bodyView === 'raw' ? 'bg-pg-hover text-pg-text-strong' : 'text-pg-text-muted hover:text-pg-text-soft'"
            @click="bodyView = 'raw'"
          >
            {{ t('response.rawTab') }}
          </button>
          <button
            type="button"
            class="rounded border px-3 py-1 transition border-pg-border disabled:cursor-not-allowed disabled:opacity-60"
            :class="bodyView === 'preview' ? 'bg-pg-hover text-pg-text-strong' : 'text-pg-text-muted hover:text-pg-text-soft'"
            :disabled="!hasPreview"
            @click="bodyView = 'preview'"
          >
            {{ t('response.previewTab') }}
          </button>
        </div>
        <div class="flex-1">
          <pre
            v-if="bodyView === 'pretty'"
            class="min-h-[160px] rounded border p-4 text-xs border-pg-border bg-pg-surface-strong text-pg-text"
            data-testid="playground-response"
          >{{ responsePretty }}</pre>
          <pre
            v-else-if="bodyView === 'raw'"
            class="min-h-[160px] rounded border p-4 text-xs border-pg-border bg-pg-surface-strong text-pg-text"
          >{{ responseRaw }}</pre>
          <div
            v-else-if="bodyView === 'preview' && !hasPreview"
            class="min-h-[160px] rounded border p-4 text-sm border-pg-border bg-pg-surface-strong text-pg-text-muted"
          >
            {{ t('response.previewEmpty') }}
          </div>
          <iframe
            v-else
            class="min-h-[160px] w-full rounded border bg-white"
            :srcdoc="previewContent"
            sandbox=""
            :title="t('response.previewTab')"
          />
        </div>
      </div>

      <div
        v-else-if="activeTab === 'headers'"
        class="min-h-[160px] rounded border p-4 text-sm border-pg-border bg-pg-surface-strong text-pg-text-muted"
      >
        <div v-if="headerEntries.length === 0">
          {{ t('response.headersEmpty') }}
        </div>
        <div v-else class="flex flex-col gap-2 text-xs text-pg-text-soft">
          <div
            v-for="[key, value] in headerEntries"
            :key="key"
            class="flex flex-wrap items-center gap-2"
          >
            <span class="rounded border px-2 py-0.5 text-[0.55rem] tracking-[0.08em] border-pg-border bg-pg-surface-card text-pg-text-soft">
              {{ key }}
            </span>
            <span class="text-pg-text">
              {{ value }}
            </span>
          </div>
        </div>
      </div>

      <div
        v-else
        class="min-h-[160px] rounded border p-4 text-sm border-pg-border bg-pg-surface-strong text-pg-text-muted"
      >
        {{ t('response.cookiesEmpty') }}
      </div>
    </div>
  </section>
</template>
