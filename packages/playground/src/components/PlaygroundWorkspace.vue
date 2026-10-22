<script setup lang="ts">
import type {
  ApiKeyLocation,
  AuthType,
  BodyType,
  PlaygroundConfigFile,
  PlaygroundConfigImpactRoute,
  PlaygroundDisabledRoute,
  PlaygroundGroup,
  PlaygroundIgnoredRoute,
  PlaygroundRoute,
  RawBodyType,
  TreeMode,
  TreeRow,
} from '../types'
import PlaygroundContent from './PlaygroundContent.vue'
import PlaygroundHeader from './PlaygroundHeader.vue'
import PlaygroundSidebar from './PlaygroundSidebar.vue'

const props = defineProps<{
  search: string
  isDragging: boolean
  splitStyle: Record<string, string>
  sidebarCollapsed: boolean
  basePath: string
  groups: PlaygroundGroup[]
  activeGroup: string
  treeMode: TreeMode
  routeMode: 'active' | 'disabled' | 'ignored'
  enabledMode: 'api' | 'config'
  disabledMode: 'api' | 'config'
  selectedConfig: PlaygroundConfigFile | null
  selectedDisabled: PlaygroundDisabledRoute | null
  selectedIgnored: PlaygroundIgnoredRoute | null
  activeTotal: number
  apiTotal: number
  disabledTotal: number
  ignoredTotal: number
  configTotal: number
  disabledApiTotal: number
  disabledConfigTotal: number
  error?: string
  loading: boolean
  hasCachedData: boolean
  filtered: PlaygroundRoute[]
  disabledFiltered: PlaygroundDisabledRoute[]
  ignoredFiltered: PlaygroundIgnoredRoute[]
  configFiltered: PlaygroundConfigFile[]
  disabledConfigFiltered: PlaygroundConfigFile[]
  treeRows: TreeRow[]
  workspaceRoot: string
  getRouteCount: (route: PlaygroundRoute) => number
  visibleCount: number
  totalCount: number
  requestMode: 'server' | 'sw' | 'sw-registering'
  scenarioNames: string[]
  activeScenario: string
  scenarioError: string
  selected: PlaygroundRoute | null
  requestUrl: string
  queryText: string
  headersText: string
  bodyText: string
  bodyType: BodyType
  rawType: RawBodyType
  rawValidate: boolean
  multipartFiles: import('../types').MultipartFileEntry[]
  binaryFile: File | null
  authType: AuthType
  authToken: string
  authUsername: string
  authPassword: string
  authKeyName: string
  authKeyValue: string
  authKeyLocation: ApiKeyLocation
  authCustomName: string
  authCustomValue: string
  responseRaw: string
  responsePretty: string
  responseHeaders: Record<string, string>
  responseContentType: string
  responseStatus: string
  responseTime: string
  isSwRegistering: boolean
  routeParams: import('../types').RouteParamField[]
  paramValues: Record<string, string>
  missingParams: string[]
  missingPulse: number
  configImpactRoutes: PlaygroundConfigImpactRoute[]
  configStatusMap: Map<string, 'enabled' | 'disabled'>
  onRefresh: () => void
  onSelectScenario: (name: string) => void
  onResetScenario: () => void
  onToggleCollapse: () => void
  onSelectGroup: (key: string) => void
  onSetRouteMode: (mode: 'active' | 'disabled' | 'ignored') => void
  onSetEnabledMode: (mode: 'api' | 'config') => void
  onSetDisabledMode: (mode: 'api' | 'config') => void
  onToggleTree: (id: string) => void
  onSelectRoute: (route: PlaygroundRoute) => void
  onSelectDisabled: (route: PlaygroundDisabledRoute) => void
  onSelectIgnored: (route: PlaygroundIgnoredRoute) => void
  onSelectConfig: (entry: PlaygroundConfigFile) => void
  onSetTreeMode: (mode: TreeMode) => void
  onDragStart: (event: PointerEvent) => void
  onSetParamValue: (name: string, value: string) => void
  onRunRequest: () => void
  onUpdateSearch: (value: string) => void
  onUpdateQueryText: (value: string) => void
  onUpdateHeadersText: (value: string) => void
  onUpdateBodyText: (value: string) => void
  onUpdateBodyType: (value: BodyType) => void
  onUpdateRawType: (value: RawBodyType) => void
  onUpdateRawValidate: (value: boolean) => void
  onUpdateMultipartFiles: (value: import('../types').MultipartFileEntry[]) => void
  onUpdateBinaryFile: (value: File | null) => void
  onUpdateAuthType: (value: AuthType) => void
  onUpdateAuthToken: (value: string) => void
  onUpdateAuthUsername: (value: string) => void
  onUpdateAuthPassword: (value: string) => void
  onUpdateAuthKeyName: (value: string) => void
  onUpdateAuthKeyValue: (value: string) => void
  onUpdateAuthKeyLocation: (value: ApiKeyLocation) => void
  onUpdateAuthCustomName: (value: string) => void
  onUpdateAuthCustomValue: (value: string) => void
}>()
</script>

<template>
  <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="flex flex-1 flex-col overflow-hidden bg-pg-surface-shell">
      <div
        class="flex min-h-0 flex-1 flex-col lg:flex-row"
        :class="props.isDragging ? 'select-none' : ''"
        :style="props.splitStyle"
      >
        <PlaygroundSidebar
          :search="props.search"
          :collapsed="props.sidebarCollapsed"
          :base-path="props.basePath"
          :groups="props.groups"
          :active-group="props.activeGroup"
          :tree-mode="props.treeMode"
          :route-mode="props.routeMode"
          :enabled-mode="props.enabledMode"
          :disabled-mode="props.disabledMode"
          :selected-config="props.selectedConfig"
          :selected-disabled="props.selectedDisabled"
          :selected-ignored="props.selectedIgnored"
          :active-total="props.activeTotal"
          :api-total="props.apiTotal"
          :disabled-total="props.disabledTotal"
          :ignored-total="props.ignoredTotal"
          :config-total="props.configTotal"
          :disabled-api-total="props.disabledApiTotal"
          :disabled-config-total="props.disabledConfigTotal"
          :error="props.error ?? ''"
          :loading="props.loading"
          :has-cached-data="props.hasCachedData"
          :filtered="props.filtered"
          :disabled-filtered="props.disabledFiltered"
          :ignored-filtered="props.ignoredFiltered"
          :config-filtered="props.configFiltered"
          :disabled-config-filtered="props.disabledConfigFiltered"
          :tree-rows="props.treeRows"
          :workspace-root="props.workspaceRoot"
          :get-route-count="props.getRouteCount"
          @toggle-collapse="props.onToggleCollapse"
          @select-group="props.onSelectGroup"
          @set-route-mode="props.onSetRouteMode"
          @set-enabled-mode="props.onSetEnabledMode"
          @set-disabled-mode="props.onSetDisabledMode"
          @toggle="props.onToggleTree"
          @select-route="props.onSelectRoute"
          @select-disabled-route="props.onSelectDisabled"
          @select-ignored-route="props.onSelectIgnored"
          @select-config="props.onSelectConfig"
          @update:treeMode="props.onSetTreeMode"
          @update:search="props.onUpdateSearch"
        />

        <div
          v-if="!props.sidebarCollapsed"
          class="pg-sash-zone relative hidden w-0 flex-none lg:flex"
          :class="props.isDragging ? 'pg-sash-active' : ''"
          @pointerdown="props.onDragStart"
        >
          <div class="pg-sash" role="separator" aria-label="Resize panels" />
        </div>

        <section class="flex min-h-0 flex-1 flex-col overflow-hidden p-4 lg:p-6">
          <PlaygroundHeader
            :visible-count="props.visibleCount"
            :total-count="props.totalCount"
            :request-mode="props.requestMode"
            :scenario-names="props.scenarioNames"
            :active-scenario="props.activeScenario"
            :scenario-error="props.scenarioError"
            @refresh="props.onRefresh"
            @select-scenario="props.onSelectScenario"
            @reset-scenario="props.onResetScenario"
          />

          <div class="mt-3 flex-1 min-h-0 overflow-auto">
            <PlaygroundContent
              :query-text="props.queryText"
              :headers-text="props.headersText"
              :body-text="props.bodyText"
              :body-type="props.bodyType"
              :raw-type="props.rawType"
              :raw-validate="props.rawValidate"
              :multipart-files="props.multipartFiles"
              :binary-file="props.binaryFile"
              :auth-type="props.authType"
              :auth-token="props.authToken"
              :auth-username="props.authUsername"
              :auth-password="props.authPassword"
              :auth-key-name="props.authKeyName"
              :auth-key-value="props.authKeyValue"
              :auth-key-location="props.authKeyLocation"
              :auth-custom-name="props.authCustomName"
              :auth-custom-value="props.authCustomValue"
              :selected="props.selected"
              :selected-disabled="props.selectedDisabled"
              :selected-ignored="props.selectedIgnored"
              :selected-config="props.selectedConfig"
              :request-url="props.requestUrl"
              :workspace-root="props.workspaceRoot"
              :response-raw="props.responseRaw"
              :response-pretty="props.responsePretty"
              :response-headers="props.responseHeaders"
              :response-content-type="props.responseContentType"
              :response-status="props.responseStatus"
              :response-time="props.responseTime"
              :is-sw-registering="props.isSwRegistering"
              :route-params="props.routeParams"
              :param-values="props.paramValues"
              :missing-params="props.missingParams"
              :missing-pulse="props.missingPulse"
              :route-mode="props.routeMode"
              :enabled-mode="props.enabledMode"
              :disabled-mode="props.disabledMode"
              :config-impact-routes="props.configImpactRoutes"
              :config-status-map="props.configStatusMap"
              @update:param-value="props.onSetParamValue"
              @run="props.onRunRequest"
              @update:queryText="props.onUpdateQueryText"
              @update:headersText="props.onUpdateHeadersText"
              @update:bodyText="props.onUpdateBodyText"
              @update:bodyType="props.onUpdateBodyType"
              @update:rawType="props.onUpdateRawType"
              @update:rawValidate="props.onUpdateRawValidate"
              @update:multipartFiles="props.onUpdateMultipartFiles"
              @update:binaryFile="props.onUpdateBinaryFile"
              @update:authType="props.onUpdateAuthType"
              @update:authToken="props.onUpdateAuthToken"
              @update:authUsername="props.onUpdateAuthUsername"
              @update:authPassword="props.onUpdateAuthPassword"
              @update:authKeyName="props.onUpdateAuthKeyName"
              @update:authKeyValue="props.onUpdateAuthKeyValue"
              @update:authKeyLocation="props.onUpdateAuthKeyLocation"
              @update:authCustomName="props.onUpdateAuthCustomName"
              @update:authCustomValue="props.onUpdateAuthCustomValue"
            />
          </div>
        </section>
      </div>
    </div>
  </main>
</template>
