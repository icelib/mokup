<script setup lang="ts">
import type { ApiKeyLocation, AuthType, BodyType, PlaygroundRoute, RawBodyType } from '../types'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveCopyOptions } from '../utils/copy'
import { buildCurl } from '../utils/curl'
import { buildFetch } from '../utils/fetch'
import UiTextInput from './ui/UiTextInput.vue'

const props = defineProps<{
  selected: PlaygroundRoute
  requestUrl: string
  headersText: string
  bodyText: string
  bodyType: BodyType
  rawType: RawBodyType
  authType: AuthType
  authToken: string
  authUsername: string
  authPassword: string
  authKeyName: string
  authKeyValue: string
  authKeyLocation: ApiKeyLocation
  authCustomName: string
  authCustomValue: string
  isSwRegistering: boolean
}>()

const emit = defineEmits<{
  (event: 'run'): void
}>()
const { t } = useI18n()
const methodBadge = computed(() => `method-${props.selected.method.toLowerCase()}`)
const copyMenuOpen = ref(false)
const copyMenuId = 'playground-copy-menu'
const copyMenuButtonRef = ref<HTMLElement | null>(null)
const copyMenuPanelRef = ref<HTMLElement | null>(null)
const copyMenuPositionStyle = ref<{ left: string, top: string }>({ left: '0px', top: '0px' })
const copiedLabel = ref('')
let copiedTimeout: ReturnType<typeof setTimeout> | null = null
let copyMenuCloseTimeout: ReturnType<typeof setTimeout> | null = null
let copyMenuAutoUpdateCleanup: ReturnType<typeof autoUpdate> | null = null
function clearCopyMenuCloseTimeout() {
  if (copyMenuCloseTimeout) {
    clearTimeout(copyMenuCloseTimeout)
    copyMenuCloseTimeout = null
  }
}
function clearCopyMenuAutoUpdate() {
  if (copyMenuAutoUpdateCleanup) {
    copyMenuAutoUpdateCleanup()
    copyMenuAutoUpdateCleanup = null
  }
}
async function updateCopyMenuPosition() {
  const reference = copyMenuButtonRef.value
  const floating = copyMenuPanelRef.value
  if (!reference || !floating) {
    return
  }
  const { x, y } = await computePosition(reference, floating, {
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  })
  copyMenuPositionStyle.value = {
    left: `${Math.round(x)}px`,
    top: `${Math.round(y)}px`,
  }
}
function openCopyMenu() {
  clearCopyMenuCloseTimeout()
  copyMenuOpen.value = true
}
function closeCopyMenu(options: { focusButton?: boolean } = {}) {
  clearCopyMenuCloseTimeout()
  copyMenuOpen.value = false
  if (options.focusButton) {
    nextTick(() => {
      copyMenuButtonRef.value?.focus()
    })
  }
}
function scheduleCopyMenuClose() {
  clearCopyMenuCloseTimeout()
  copyMenuCloseTimeout = setTimeout(() => {
    copyMenuCloseTimeout = null
    closeCopyMenu()
  }, 120)
}
function keepCopyMenuOpen() {
  clearCopyMenuCloseTimeout()
  copyMenuOpen.value = true
}
function handleDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (!target) {
    return
  }
  const button = copyMenuButtonRef.value
  const panel = copyMenuPanelRef.value
  if (button?.contains(target) || panel?.contains(target)) {
    return
  }
  closeCopyMenu()
}
function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') {
    return
  }
  closeCopyMenu({ focusButton: true })
}
watch(copyMenuOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', handleDocumentPointerDown)
    document.addEventListener('keydown', handleDocumentKeydown)
    void nextTick().then(() => {
      if (!copyMenuOpen.value) {
        return
      }
      const reference = copyMenuButtonRef.value
      const floating = copyMenuPanelRef.value
      if (!reference || !floating) {
        return
      }
      void updateCopyMenuPosition()
      clearCopyMenuAutoUpdate()
      copyMenuAutoUpdateCleanup = autoUpdate(reference, floating, () => {
        void updateCopyMenuPosition()
      })
    })
    return
  }
  clearCopyMenuAutoUpdate()
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
})
function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text)
  copiedLabel.value = label
  closeCopyMenu()
  if (copiedTimeout) {
    clearTimeout(copiedTimeout)
  }
  copiedTimeout = setTimeout(() => {
    copiedLabel.value = ''
    copiedTimeout = null
  }, 2000)
}
function handleCopyUrl() {
  copyToClipboard(props.requestUrl, 'url')
}
function resolveCopyBuildOptions() {
  return resolveCopyOptions({
    method: props.selected.method,
    url: new URL(props.requestUrl, window.location.origin).href,
    headersText: props.headersText,
    bodyType: props.bodyType,
    rawType: props.rawType,
    bodyText: props.bodyText,
    authType: props.authType,
    authToken: props.authToken,
    authUsername: props.authUsername,
    authPassword: props.authPassword,
    authKeyName: props.authKeyName,
    authKeyValue: props.authKeyValue,
    authKeyLocation: props.authKeyLocation,
    authCustomName: props.authCustomName,
    authCustomValue: props.authCustomValue,
  })
}
function handleCopyCurl() {
  copyToClipboard(buildCurl(resolveCopyBuildOptions()), 'curl')
}
function handleCopyFetch() {
  copyToClipboard(buildFetch(resolveCopyBuildOptions()), 'fetch')
}
onBeforeUnmount(() => {
  clearCopyMenuCloseTimeout()
  clearCopyMenuAutoUpdate()
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
  if (copiedTimeout) {
    clearTimeout(copiedTimeout)
    copiedTimeout = null
  }
})
</script>

<template>
  <div class="flex flex-col gap-3 px-4 py-4">
    <div class="flex flex-wrap items-center gap-2">
      <span
        class="inline-flex h-9 w-[96px] flex-none items-center justify-center rounded border px-3 text-[0.65rem] tracking-[0.1em] border-pg-border bg-pg-surface-strong text-pg-text"
        :class="methodBadge"
      >
        {{ props.selected.method.toUpperCase() }}
      </span>
      <UiTextInput
        :value="props.requestUrl"
        readonly
        class="h-9 min-w-[220px] flex-1"
      />
      <div class="relative">
        <button
          ref="copyMenuButtonRef"
          class="inline-flex h-9 items-center gap-2 rounded px-4 text-[0.65rem] tracking-[0.1em] transition border border-pg-border bg-pg-surface-strong text-pg-text-muted hover:text-pg-text-soft"
          type="button"
          :aria-expanded="copyMenuOpen ? 'true' : 'false'"
          :aria-controls="copyMenuId"
          aria-haspopup="menu"
          @mouseenter="keepCopyMenuOpen"
          @mouseleave="scheduleCopyMenuClose"
          @click="openCopyMenu"
          @keydown.down.prevent="openCopyMenu"
        >
          <span
            class="h-3.5 w-3.5"
            :class="copiedLabel ? 'i-[carbon--checkmark]' : 'i-[carbon--copy]'"
            aria-hidden="true"
          />
          {{ copiedLabel ? t('detail.copyMenuDone') : t('detail.copyMenu') }}
          <span class="i-[carbon--chevron-down] h-3 w-3" aria-hidden="true" />
        </button>
        <div
          v-if="copyMenuOpen"
          :id="copyMenuId"
          ref="copyMenuPanelRef"
          class="z-20 min-w-[160px] rounded border py-1 border-pg-border bg-pg-surface-card shadow-sm"
          style="position: fixed;"
          :style="copyMenuPositionStyle"
          role="menu"
          @mouseenter="keepCopyMenuOpen"
          @mouseleave="scheduleCopyMenuClose"
        >
          <button
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.65rem] tracking-[0.08em] transition text-pg-text-soft hover:bg-pg-hover-strong"
            type="button"
            role="menuitem"
            @click="handleCopyUrl"
          >
            <span class="i-[carbon--link] h-3.5 w-3.5" aria-hidden="true" />
            {{ t('detail.copyUrl') }}
          </button>
          <button
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.65rem] tracking-[0.08em] transition text-pg-text-soft hover:bg-pg-hover-strong"
            type="button"
            role="menuitem"
            @click="handleCopyCurl"
          >
            <span class="i-[carbon--terminal] h-3.5 w-3.5" aria-hidden="true" />
            {{ t('detail.copyCurl') }}
          </button>
          <button
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[0.65rem] tracking-[0.08em] transition text-pg-text-soft hover:bg-pg-hover-strong"
            type="button"
            role="menuitem"
            @click="handleCopyFetch"
          >
            <span class="i-[carbon--code] h-3.5 w-3.5" aria-hidden="true" />
            {{ t('detail.copyFetch') }}
          </button>
        </div>
      </div>
      <button
        class="inline-flex h-9 items-center gap-2 rounded px-4 text-[0.65rem] tracking-[0.1em] transition disabled:cursor-not-allowed disabled:opacity-70 bg-pg-accent text-pg-on-accent"
        data-testid="playground-run"
        :disabled="props.isSwRegistering"
        :aria-busy="props.isSwRegistering"
        @click="emit('run')"
      >
        <span
          v-if="props.isSwRegistering"
          class="i-[carbon--circle-dash] h-3.5 w-3.5 animate-spin"
          aria-hidden="true"
        />
        {{ t('detail.run') }}
      </button>
    </div>
    <div class="text-[0.65rem] text-pg-text-subtle">
      {{ props.selected.file }}
    </div>
  </div>
</template>
