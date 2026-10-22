<script setup lang="ts">
import type { PlaygroundLocale } from '../i18n'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlaygroundTheme } from '../hooks/usePlaygroundTheme'
import { persistLocale } from '../i18n'
import UiChipButton from './ui/UiChipButton.vue'
import UiPill from './ui/UiPill.vue'

const props = defineProps<{
  visibleCount: number
  totalCount: number
  requestMode: 'server' | 'sw' | 'sw-registering'
  scenarioNames: string[]
  activeScenario: string
  scenarioError: string
}>()

const emit = defineEmits<{
  (event: 'refresh'): void
  (event: 'select-scenario', name: string): void
  (event: 'reset-scenario'): void
}>()

const { locale, t } = useI18n()
const { themeMode, effectiveTheme, cycleThemeMode } = usePlaygroundTheme()

const themeIcon = computed(() =>
  effectiveTheme.value === 'dark' ? 'i-[carbon--moon]' : 'i-[carbon--sun]',
)
const themeLabel = computed(() => t(`theme.${themeMode.value}`))
const localeLabel = computed(() => (locale.value === 'zh-CN' ? '中文' : 'EN'))
const modeLabel = computed(() => {
  if (props.requestMode === 'sw-registering') {
    return t('header.mode', { mode: t('header.modeSwRegistering') })
  }
  if (props.requestMode === 'sw') {
    return t('header.mode', { mode: t('header.modeSw') })
  }
  return t('header.mode', { mode: t('header.modeServer') })
})
const modeIcon = computed(() => {
  if (props.requestMode === 'sw-registering') {
    return 'i-[carbon--time]'
  }
  if (props.requestMode === 'sw') {
    return 'i-[carbon--network-3]'
  }
  return 'i-[carbon--bare-metal-server]'
})

function toggleLocale() {
  const next = locale.value === 'en-US' ? 'zh-CN' : 'en-US'
  locale.value = next
  persistLocale(next as PlaygroundLocale)
}

function handleRefresh() {
  emit('refresh')
}

function handleScenario(event: Event) {
  const name = (event.target as HTMLSelectElement).value
  if (name) {
    emit('select-scenario', name)
  }
}
</script>

<template>
  <div class="flex flex-none flex-wrap items-center justify-between gap-2 rounded-t border px-3 py-1.5 text-xs border-pg-border bg-pg-surface-card text-pg-text-soft">
    <div class="flex flex-wrap items-center gap-2">
      <UiPill tone="strong" size="xs">
        <span class="i-[carbon--map] h-3.5 w-3.5" aria-hidden="true" />
        <span>{{ t('header.routes', { count: visibleCount }) }}</span>
      </UiPill>
      <UiPill tone="strong" size="xs">
        <span class="i-[carbon--activity] h-3.5 w-3.5" aria-hidden="true" />
        <span>{{ t('header.calls', { count: totalCount }) }}</span>
      </UiPill>
      <UiPill tone="strong" size="xs">
        <span :class="modeIcon" class="h-3.5 w-3.5" aria-hidden="true" />
        <span>{{ modeLabel }}</span>
      </UiPill>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <div v-if="props.scenarioNames.length" class="flex items-center gap-1.5">
        <label for="mokup-scenario" class="text-pg-text-muted">{{ t('header.scenario') }}</label>
        <select
          id="mokup-scenario"
          class="rounded border px-2 py-1 text-xs border-pg-border bg-pg-surface-card text-pg-text"
          :value="props.activeScenario"
          @change="handleScenario"
        >
          <option v-for="name in props.scenarioNames" :key="name" :value="name">
            {{ name }}
          </option>
        </select>
        <UiChipButton size="xs" :title="t('header.scenarioReset')" @click="emit('reset-scenario')">
          {{ t('header.scenarioReset') }}
        </UiChipButton>
      </div>
      <span v-if="props.scenarioError" class="text-red-400" role="status">
        {{ t('header.scenarioError', { message: props.scenarioError }) }}
      </span>
      <UiChipButton
        size="xs"
        :title="t('header.languageToggle')"
        @click="toggleLocale"
      >
        <span class="i-[carbon--language] h-3.5 w-3.5" aria-hidden="true" />
        <span>{{ localeLabel }}</span>
      </UiChipButton>
      <UiChipButton
        size="xs"
        :title="t('header.themeToggle')"
        @click="cycleThemeMode"
      >
        <span :class="themeIcon" class="h-3.5 w-3.5" aria-hidden="true" />
        <span>{{ themeLabel }}</span>
      </UiChipButton>
      <UiChipButton
        size="xs"
        @click="handleRefresh"
      >
        <span class="i-[carbon--rotate] h-3.5 w-3.5" aria-hidden="true" />
        <span>{{ t('header.refresh') }}</span>
      </UiChipButton>
    </div>
  </div>
</template>
