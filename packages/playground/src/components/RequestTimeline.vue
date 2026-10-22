<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { requestCoverageKey, requestCoverageTotalsKey } from '../hooks/playground-request/coverage'
import { diffResponses, exportMockResponse, requestHistoryKey } from '../hooks/playground-request/history'

const { t } = useI18n()
const history = inject(requestHistoryKey, ref([]))
const coverage = inject(requestCoverageKey, ref([]))
const totals = inject(requestCoverageTotalsKey, ref({ started: 0, completed: 0, mocked: 0, bypassed: 0, unhandled: 0, errors: 0 }))
const selectedId = ref<number>()
const exportStatus = ref('')
const selected = computed(() => history.value.find(entry => entry.id === selectedId.value) ?? history.value[0])
const decisionChain = computed(() => selected.value?.decisionChain ?? [])
const previous = computed(() => history.value.find(entry => selected.value && entry.id < selected.value.id && entry.routeKey === selected.value.routeKey))
const differences = computed(() => selected.value && previous.value && !selected.value.truncated && !previous.value.truncated
  ? diffResponses(previous.value.body, selected.value.body)
  : undefined)
async function copyResponse(format: 'msw' | 'playwright') {
  if (!selected.value) {
    return
  }
  try {
    await navigator.clipboard.writeText(exportMockResponse(selected.value, format))
    exportStatus.value = t('detail.copyMenuDone')
  }
  catch (error) {
    exportStatus.value = error instanceof Error ? error.message : String(error)
  }
}
function decisionResultLabel(result: string) {
  return t(`response.decisionResult.${result}`)
}
</script>

<template>
  <div class="space-y-3 text-xs text-pg-text" data-testid="request-timeline">
    <div class="flex justify-between gap-3">
      <p class="text-pg-text-muted">
        {{ t('response.historyHint') }}
      </p>
      <button type="button" class="text-pg-accent" @click="history = []">
        {{ t('response.clearHistory') }}
      </button>
    </div>
    <p v-if="!history.length">
      {{ t('response.empty') }}
    </p>
    <ol v-else class="space-y-1">
      <li v-for="entry in history" :key="entry.id">
        <button type="button" class="flex w-full flex-wrap gap-3 rounded border px-3 py-2 text-left border-pg-border" :class="selected?.id === entry.id ? 'bg-pg-hover' : ''" @click="selectedId = entry.id">
          <time :datetime="entry.time">{{ new Date(entry.time).toLocaleTimeString() }}</time>
          <span class="font-mono">{{ entry.method }} {{ entry.path }}</span>
          <span>{{ entry.error ? t('response.error') : entry.status }}</span>
          <span>{{ entry.duration }}ms</span>
        </button>
      </li>
    </ol>
    <p v-if="selected?.error" role="status">
      {{ selected.error }}
    </p>
    <div v-if="decisionChain.length" class="space-y-2" data-testid="request-decision-chain">
      <p class="text-pg-text-muted">
        {{ t('response.decisionChain') }}
      </p>
      <ol class="space-y-1">
        <li v-for="(decision, index) in decisionChain" :key="`${decision.method}-${decision.matcher}-${index}`" class="rounded border p-2 border-pg-border">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono">{{ decision.method }} {{ decision.matcher }}</span>
            <span class="rounded bg-pg-hover px-1.5 py-0.5">{{ decisionResultLabel(decision.result) }}</span>
          </div>
          <p v-if="decision.detail" class="mt-1 text-pg-text-muted">
            {{ decision.detail }}
          </p>
        </li>
      </ol>
    </div>
    <div v-if="selected" class="flex flex-wrap gap-3">
      <button v-for="format in (['msw', 'playwright'] as const)" :key="format" type="button" class="rounded border px-3 py-1 border-pg-border disabled:opacity-50" :disabled="selected.truncated || selected.status === null || !!selected.error" @click="copyResponse(format)">
        {{ t('response.copyMock', { format: format === 'msw' ? 'MSW' : 'Playwright' }) }}
      </button>
      <span role="status">{{ exportStatus }}</span>
    </div>
    <div v-if="differences" class="space-y-2" data-testid="response-diff">
      <p class="text-pg-text-muted">
        {{ t('response.diffLabel') }}
      </p>
      <p v-if="!differences.length">
        {{ t('response.diffUnchanged') }}
      </p>
      <div v-for="change in differences" :key="change.path" class="rounded border p-3 border-pg-border font-mono">
        <p>{{ change.path }}</p>
        <pre class="whitespace-pre-wrap break-all">− {{ change.before }}
+ {{ change.after }}</pre>
      </div>
    </div>
    <div v-if="coverage.length" class="space-y-2" data-testid="handler-coverage">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-pg-text-muted">
          {{ t('response.coverageLabel') }}
        </p>
        <span class="text-pg-text-subtle">
          {{ t('response.coverageTotals', totals) }}
        </span>
      </div>
      <div class="grid gap-1">
        <div v-for="handler in coverage" :key="handler.id" class="flex flex-wrap items-center gap-2 rounded border p-2 border-pg-border">
          <span class="min-w-0 flex-1 truncate font-mono">{{ handler.method }} {{ handler.matcher }}</span>
          <span class="rounded px-1.5 py-0.5" :class="handler.matched ? 'bg-emerald-500/20 text-emerald-300' : 'bg-pg-hover text-pg-text-muted'">
            {{ t('response.coverageCount', { count: handler.mocked }) }}
          </span>
          <span v-if="!handler.active" class="text-pg-text-subtle">
            {{ t('response.coverageInactive') }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
