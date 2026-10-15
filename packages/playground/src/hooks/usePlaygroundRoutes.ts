import type {
  PlaygroundConfigFile,
  PlaygroundConfigImpactRoute,
  PlaygroundDisabledRoute,
  PlaygroundGroup,
  PlaygroundIgnoredRoute,
  PlaygroundResponse,
  PlaygroundRoute,
} from '../types'
import { computed, ref, watch } from 'vue'
import { normalizeBasePath } from '../utils/path'
import { parseSearchTokens } from '../utils/search'
import { persistLastSelectedRouteKey, readLastSelectedRouteKey } from '../utils/selection'
import { buildConfigImpactRoutes } from './playground-config-impact'
import { matchConfigTokens, matchDisabledTokens, matchIgnoredTokens, matchRouteTokens } from './playground-route-search'

export function usePlaygroundRoutes() {
  const routes = ref<PlaygroundRoute[]>([])
  const disabledRoutes = ref<PlaygroundDisabledRoute[]>([])
  const ignoredRoutes = ref<PlaygroundIgnoredRoute[]>([])
  const configFiles = ref<PlaygroundConfigFile[]>([])
  const disabledConfigFiles = ref<PlaygroundConfigFile[]>([])
  const filtered = ref<PlaygroundRoute[]>([])
  const configFiltered = ref<PlaygroundConfigFile[]>([])
  const disabledConfigFiltered = ref<PlaygroundConfigFile[]>([])
  const selected = ref<PlaygroundRoute | null>(null)
  const selectedDisabled = ref<PlaygroundDisabledRoute | null>(null)
  const selectedIgnored = ref<PlaygroundIgnoredRoute | null>(null)
  const selectedConfig = ref<PlaygroundConfigFile | null>(null)
  const groups = ref<PlaygroundGroup[]>([])
  const activeGroup = ref('all')
  const loading = ref(false)
  const error = ref('')
  const search = ref('')
  const basePath = ref('')
  const workspaceRoot = ref('')

  const searchTerm = computed(() => search.value.trim().toLowerCase())
  const parsedSearch = computed(() => parseSearchTokens(search.value))
  const routeCount = computed(() => filtered.value.length)
  const disabledCount = computed(() => disabledRoutes.value.length)
  const ignoredCount = computed(() => ignoredRoutes.value.length)
  const configCount = computed(() => configFiles.value.length)
  const disabledConfigCount = computed(() => disabledConfigFiles.value.length)
  const configStatusMap = computed<Map<string, 'enabled' | 'disabled'>>(() => {
    const map = new Map<string, 'enabled' | 'disabled'>()
    for (const entry of configFiles.value) {
      map.set(entry.file, 'enabled')
    }
    for (const entry of disabledConfigFiles.value) {
      map.set(entry.file, 'disabled')
    }
    return map
  })
  const routesEndpoint = computed(() => {
    const base = normalizeBasePath(basePath.value)
    return `${base}/routes`
  })

  const routeKey = (route: PlaygroundRoute) => `${route.method} ${route.url}`
  const disabledKey = (route: PlaygroundDisabledRoute) =>
    `${route.file}|${route.reason}|${route.method ?? ''}|${route.url ?? ''}`
  const ignoredKey = (route: PlaygroundIgnoredRoute) => `${route.file}|${route.reason}`
  const lastSelectedKey = ref(readLastSelectedRouteKey() ?? '')

  function resolveRouteFromKey(key: string, list: PlaygroundRoute[]) {
    if (!key) {
      return null
    }
    return list.find(route => routeKey(route) === key) ?? null
  }

  function getGroupRoutes() {
    return activeGroup.value === 'all'
      ? routes.value
      : routes.value.filter(route => route.groupKey === activeGroup.value)
  }

  function applyFilter() {
    const tokens = parsedSearch.value
    const list = getGroupRoutes()
    filtered.value = tokens.length
      ? list.filter(route => matchRouteTokens(route, tokens))
      : [...list]
  }

  function getGroupConfigs() {
    return activeGroup.value === 'all'
      ? configFiles.value
      : configFiles.value.filter(entry => entry.groupKey === activeGroup.value)
  }

  function applyConfigFilter() {
    const tokens = parsedSearch.value
    const list = getGroupConfigs()
    configFiltered.value = tokens.length
      ? list.filter(entry => matchConfigTokens(entry, tokens))
      : [...list]
  }

  function getGroupDisabledConfigs() {
    return activeGroup.value === 'all'
      ? disabledConfigFiles.value
      : disabledConfigFiles.value.filter(entry => entry.groupKey === activeGroup.value)
  }

  function applyDisabledConfigFilter() {
    const tokens = parsedSearch.value
    const list = getGroupDisabledConfigs()
    disabledConfigFiltered.value = tokens.length
      ? list.filter(entry => matchConfigTokens(entry, tokens))
      : [...list]
  }
  const applyAllFilters = () => {
    applyFilter()
    applyConfigFilter()
    applyDisabledConfigFilter()
  }

  const disabledFiltered = computed(() => {
    const tokens = parsedSearch.value
    if (!tokens.length) {
      return [...disabledRoutes.value]
    }
    return disabledRoutes.value.filter(route => matchDisabledTokens(route, tokens))
  })

  const ignoredFiltered = computed(() => {
    const tokens = parsedSearch.value
    if (!tokens.length) {
      return [...ignoredRoutes.value]
    }
    return ignoredRoutes.value.filter(route => matchIgnoredTokens(route, tokens))
  })

  function setActiveGroup(key: string) {
    activeGroup.value = key
    applyAllFilters()
    if (selected.value) {
      const selectedInList = filtered.value.some(route => routeKey(route) === routeKey(selected.value!))
      if (selectedInList) {
        return
      }
    }
    selected.value = resolveRouteFromKey(lastSelectedKey.value, filtered.value)
  }

  const selectRoute = (route: PlaygroundRoute | null) => (selected.value = route)
  const selectDisabledRoute = (route: PlaygroundDisabledRoute | null) => (selectedDisabled.value = route)
  const selectIgnoredRoute = (route: PlaygroundIgnoredRoute | null) => (selectedIgnored.value = route)
  const selectConfig = (config: PlaygroundConfigFile | null) => (selectedConfig.value = config)
  const setBasePath = (pathname: string) => (basePath.value = normalizeBasePath(pathname) || '/')

  async function loadRoutes() {
    loading.value = true
    error.value = ''
    const previousKey = lastSelectedKey.value
    const previousDisabledKey = selectedDisabled.value
      ? disabledKey(selectedDisabled.value)
      : ''
    const previousIgnoredKey = selectedIgnored.value
      ? ignoredKey(selectedIgnored.value)
      : ''
    const previousGroup = activeGroup.value
    const previousConfig = selectedConfig.value?.file ?? ''
    try {
      const response = await fetch(routesEndpoint.value)
      if (!response.ok) {
        throw new Error(`Failed to load routes: ${response.status}`)
      }
      const data = await response.json() as PlaygroundResponse
      routes.value = data.routes ?? []
      disabledRoutes.value = data.disabled ?? []
      ignoredRoutes.value = data.ignored ?? []
      configFiles.value = data.configs ?? []
      disabledConfigFiles.value = data.disabledConfigs ?? []
      groups.value = data.groups ?? []
      workspaceRoot.value = data.root ?? ''
      if (previousGroup !== 'all') {
        const exists = groups.value.some(group => group.key === previousGroup)
        if (!exists) {
          activeGroup.value = 'all'
        }
      }
      applyAllFilters()
      const match = previousKey
        ? resolveRouteFromKey(previousKey, filtered.value)
        : null
      if (previousKey && !match) {
        const exists = resolveRouteFromKey(previousKey, routes.value)
        if (!exists) {
          lastSelectedKey.value = ''
          persistLastSelectedRouteKey(null)
        }
      }
      selected.value = match
      if (previousDisabledKey) {
        const match = disabledRoutes.value.find(route => disabledKey(route) === previousDisabledKey)
        selectedDisabled.value = match ?? disabledRoutes.value[0] ?? null
      }
      else {
        selectedDisabled.value = disabledRoutes.value[0] ?? null
      }
      if (previousIgnoredKey) {
        const match = ignoredRoutes.value.find(route => ignoredKey(route) === previousIgnoredKey)
        selectedIgnored.value = match ?? ignoredRoutes.value[0] ?? null
      }
      else {
        selectedIgnored.value = ignoredRoutes.value[0] ?? null
      }
      if (previousConfig) {
        const configMatch = configFiles.value.find(entry => entry.file === previousConfig)
          ?? disabledConfigFiles.value.find(entry => entry.file === previousConfig)
          ?? null
        selectedConfig.value = configMatch
      }
    }
    catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
    finally {
      loading.value = false
    }
  }

  watch(search, () => {
    applyAllFilters()
  })

  watch(selected, (value) => {
    if (value) {
      const key = routeKey(value)
      lastSelectedKey.value = key
      persistLastSelectedRouteKey(key)
    }
  })

  const configImpactRoutes = computed<PlaygroundConfigImpactRoute[]>(() => {
    const selectedFile = selectedConfig.value?.file
    const params = {
      routes: routes.value,
      disabledRoutes: disabledRoutes.value,
      ignoredRoutes: ignoredRoutes.value,
    }
    return selectedFile
      ? buildConfigImpactRoutes({ ...params, selectedFile })
      : buildConfigImpactRoutes(params)
  })

  return {
    routes,
    disabledRoutes,
    ignoredRoutes,
    configFiles,
    disabledConfigFiles,
    disabledFiltered,
    ignoredFiltered,
    configFiltered,
    disabledConfigFiltered,
    filtered,
    selected,
    selectedConfig,
    selectedDisabled,
    selectedIgnored,
    groups,
    activeGroup,
    loading,
    error,
    search,
    basePath,
    workspaceRoot,
    searchTerm,
    routeCount,
    disabledCount,
    ignoredCount,
    configCount,
    disabledConfigCount,
    configStatusMap,
    routeKey,
    lastSelectedKey,
    loadRoutes,
    setActiveGroup,
    selectRoute,
    selectDisabledRoute,
    selectIgnoredRoute,
    selectConfig,
    setBasePath,
    configImpactRoutes,
  }
}
