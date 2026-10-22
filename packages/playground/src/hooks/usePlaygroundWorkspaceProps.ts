import type PlaygroundWorkspace from '../components/PlaygroundWorkspace.vue'
import type {
  ApiKeyLocation,
  AuthType,
  BodyType,
  MultipartFileEntry,
  PlaygroundConfigFile,
  PlaygroundDisabledRoute,
  PlaygroundIgnoredRoute,
  PlaygroundRoute,
  RawBodyType,
  TreeMode,
} from '../types'
import { computed } from 'vue'

type WorkspaceProps = InstanceType<typeof PlaygroundWorkspace>['$props']

function usePlaygroundWorkspaceProps(params: {
  refs: Record<string, { value: unknown }>
  getRouteCount: (route: PlaygroundRoute) => number
  handleRefresh: () => void
  selectScenario: (name: string) => void
  resetScenario: () => void
  toggleSidebar: () => void
  setActiveGroup: (key: string) => void
  setRouteMode: (mode: 'active' | 'disabled' | 'ignored') => void
  setEnabledMode: (mode: 'api' | 'config') => void
  setDisabledMode: (mode: 'api' | 'config') => void
  toggleExpanded: (id: string) => void
  handleSelectRoute: (route: PlaygroundRoute | null) => void
  handleSelectDisabled: (route: PlaygroundDisabledRoute | null) => void
  handleSelectIgnored: (route: PlaygroundIgnoredRoute | null) => void
  handleSelectConfig: (config: PlaygroundConfigFile | null) => void
  setTreeMode: (mode: TreeMode) => void
  handleDragStart: (event: PointerEvent) => void
  setParamValue: (name: string, value: string) => void
  runRequest: () => Promise<void>
  search: { value: string }
  queryText: { value: string }
  headersText: { value: string }
  bodyText: { value: string }
  bodyType: { value: BodyType }
  rawType: { value: RawBodyType }
  rawValidate: { value: boolean }
  multipartFiles: { value: MultipartFileEntry[] }
  binaryFile: { value: File | null }
  authType: { value: AuthType }
  authToken: { value: string }
  authUsername: { value: string }
  authPassword: { value: string }
  authKeyName: { value: string }
  authKeyValue: { value: string }
  authKeyLocation: { value: ApiKeyLocation }
  authCustomName: { value: string }
  authCustomValue: { value: string }
}) {
  const workspaceHandlers = {
    getRouteCount: params.getRouteCount,
    onRefresh: params.handleRefresh,
    onSelectScenario: params.selectScenario,
    onResetScenario: params.resetScenario,
    onToggleCollapse: params.toggleSidebar,
    onSelectGroup: params.setActiveGroup,
    onSetRouteMode: params.setRouteMode,
    onSetEnabledMode: params.setEnabledMode,
    onSetDisabledMode: params.setDisabledMode,
    onToggleTree: params.toggleExpanded,
    onSelectRoute: params.handleSelectRoute,
    onSelectDisabled: params.handleSelectDisabled,
    onSelectIgnored: params.handleSelectIgnored,
    onSelectConfig: params.handleSelectConfig,
    onSetTreeMode: params.setTreeMode,
    onDragStart: params.handleDragStart,
    onSetParamValue: params.setParamValue,
    onRunRequest: params.runRequest,
    onUpdateSearch: (value: string) => { params.search.value = value },
    onUpdateQueryText: (value: string) => { params.queryText.value = value },
    onUpdateHeadersText: (value: string) => { params.headersText.value = value },
    onUpdateBodyText: (value: string) => { params.bodyText.value = value },
    onUpdateBodyType: (value: BodyType) => { params.bodyType.value = value },
    onUpdateRawType: (value: RawBodyType) => { params.rawType.value = value },
    onUpdateRawValidate: (value: boolean) => { params.rawValidate.value = value },
    onUpdateMultipartFiles: (value: MultipartFileEntry[]) => { params.multipartFiles.value = value },
    onUpdateBinaryFile: (value: File | null) => { params.binaryFile.value = value },
    onUpdateAuthType: (value: AuthType) => { params.authType.value = value },
    onUpdateAuthToken: (value: string) => { params.authToken.value = value },
    onUpdateAuthUsername: (value: string) => { params.authUsername.value = value },
    onUpdateAuthPassword: (value: string) => { params.authPassword.value = value },
    onUpdateAuthKeyName: (value: string) => { params.authKeyName.value = value },
    onUpdateAuthKeyValue: (value: string) => { params.authKeyValue.value = value },
    onUpdateAuthKeyLocation: (value: ApiKeyLocation) => { params.authKeyLocation.value = value },
    onUpdateAuthCustomName: (value: string) => { params.authCustomName.value = value },
    onUpdateAuthCustomValue: (value: string) => { params.authCustomValue.value = value },
  }

  const workspaceProps = computed<WorkspaceProps>(() => ({
    ...Object.fromEntries(Object.entries(params.refs).map(([key, value]) => [key, value.value])),
    ...workspaceHandlers,
  }) as unknown as WorkspaceProps)

  return { workspaceProps }
}

export { usePlaygroundWorkspaceProps }
