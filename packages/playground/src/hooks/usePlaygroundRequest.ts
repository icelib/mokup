import type { RouteToken } from '@mokup/runtime'
import type { Ref } from 'vue'
import type { ApiKeyLocation, AuthType, BodyType, MultipartFileEntry, PlaygroundRoute, RawBodyType, RouteParamField } from '../types'
import type { RequestHistoryEntry } from './playground-request/history'
import type { PlaygroundDiagnosticsTotals, PlaygroundHandlerCoverage, PlaygroundScenario, PlaygroundWsDiagnostic, RouteCounts } from './playground-request/websocket'
import { parseRouteTemplate } from '@mokup/runtime'
import { computed, getCurrentInstance, onBeforeUnmount, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseJsonInput } from '../utils/request'
import { requestCoverageKey, requestCoverageTotalsKey } from './playground-request/coverage'
import { requestHistoryKey } from './playground-request/history'
import { buildDisplayPath, buildRouteParams } from './playground-request/params'
import { buildQueryString } from './playground-request/query'
import { createRequestRunner } from './playground-request/request-runner'
import { isMokupController, resolveMokupRegistration } from './playground-request/service-worker'
import { parseWsMessage, resolvePlaygroundWsUrl } from './playground-request/websocket'

let swReadyPromise: Promise<void> | null = null

export function usePlaygroundRequest(
  selected: Ref<PlaygroundRoute | null>,
  options: { basePath?: Ref<string> } = {},
) {
  const { t } = useI18n()
  const queryText = ref('')
  const headersText = ref('')
  const bodyText = ref('')
  const bodyType = ref<BodyType>('none')
  const rawType = ref<RawBodyType>('json')
  const rawValidate = ref(true)
  const binaryFile = ref<File | null>(null)
  const multipartFiles = ref<MultipartFileEntry[]>([])
  const authType = ref<AuthType>('none')
  const authToken = ref('')
  const authUsername = ref('')
  const authPassword = ref('')
  const authKeyName = ref('')
  const authKeyValue = ref('')
  const authKeyLocation = ref<ApiKeyLocation>('header')
  const authCustomName = ref('')
  const authCustomValue = ref('')
  const responseRaw = ref('')
  const responsePretty = ref(t('response.empty'))
  const responseText = responsePretty
  const responseHeaders = ref<Record<string, string>>({})
  const responseContentType = ref('')
  const responseStatus = ref(t('response.idle'))
  const responseTime = ref('')
  const requestHistory = ref<RequestHistoryEntry[]>([])
  const handlerCoverage = ref<PlaygroundHandlerCoverage[]>([])
  const coverageTotals = ref<PlaygroundDiagnosticsTotals>({ started: 0, completed: 0, mocked: 0, bypassed: 0, unhandled: 0, errors: 0 })
  const serverHistoryRequestIds = new Set<string>()
  let historyId = 0
  if (getCurrentInstance()) {
    provide(requestHistoryKey, requestHistory)
    provide(requestCoverageKey, handlerCoverage)
    provide(requestCoverageTotalsKey, coverageTotals)
  }
  const requestPayloadState = {
    queryText,
    headersText,
    bodyText,
    bodyType,
    rawType,
    rawValidate,
    multipartFiles,
    binaryFile,
  }
  const authState = {
    authType,
    authToken,
    authUsername,
    authPassword,
    authKeyName,
    authKeyValue,
    authKeyLocation,
    authCustomName,
    authCustomValue,
  }
  const responseState = {
    responseRaw,
    responsePretty,
    responseText,
    responseHeaders,
    responseContentType,
    responseStatus,
    responseTime,
  }
  const isSwMode = ref(false)
  const isSwReady = ref(false)
  const isSwRegistering = computed(() => isSwMode.value && !isSwReady.value)
  const routeCounts = ref<RouteCounts>({})
  const totalCount = computed(() => Object.values(routeCounts.value).reduce((sum, value) => sum + value, 0))
  const isServerCounts = ref(false)
  const scenarioNames = ref<string[]>([])
  const activeScenario = ref('')
  const scenarioError = ref('')
  const wsRef = ref<WebSocket | null>(null)
  const wsUrlRef = ref('')
  const routeTokens = ref<RouteToken[]>([])
  const routeParams = ref<RouteParamField[]>([])
  const paramValues = ref<Record<string, string>>({})
  const missingParams = ref<string[]>([])
  const missingPulse = ref(0)
  const requestUrl = computed(() => {
    if (!selected.value) {
      return ''
    }
    const tokens = routeTokens.value.length > 0
      ? routeTokens.value
      : parseRouteTemplate(selected.value.url).tokens
    const path = buildDisplayPath(tokens, paramValues.value)
    const parsedQuery = parseJsonInput(queryText.value)
    if (parsedQuery.error || !parsedQuery.value) {
      return path
    }
    return `${path}${buildQueryString(parsedQuery.value)}`
  })

  const getRouteKey = (route: PlaygroundRoute) => `${route.method} ${route.url}`
  const getRouteCount = (route: PlaygroundRoute) => routeCounts.value[getRouteKey(route)] ?? 0

  function appendServerDiagnostic(diagnostic: PlaygroundWsDiagnostic) {
    if (!['response:mocked', 'response:bypass', 'request:unhandled'].includes(diagnostic.entry.type)) {
      return
    }
    if (serverHistoryRequestIds.has(diagnostic.entry.requestId)) {
      return
    }
    serverHistoryRequestIds.add(diagnostic.entry.requestId)
    let path = diagnostic.entry.url
    try {
      const url = new URL(diagnostic.entry.url)
      path = `${url.pathname}${url.search}`
    }
    catch {
      // Keep the transport URL when a custom adapter emits a relative value.
    }
    requestHistory.value = [{
      id: ++historyId,
      method: diagnostic.entry.method,
      path,
      routeKey: `${diagnostic.entry.method} ${path}`,
      status: diagnostic.entry.status ?? null,
      duration: 0,
      time: new Date(diagnostic.entry.timestamp).toISOString(),
      ...(diagnostic.entry.error ? { error: diagnostic.entry.error.message } : {}),
      body: '',
      contentType: '',
      truncated: true,
      ...(diagnostic.entry.decisionChain
        ? { decisionChain: diagnostic.entry.decisionChain.map(decision => ({ ...decision })) }
        : {}),
    }, ...requestHistory.value].slice(0, 50)
  }

  function applyCoverage(handlers: PlaygroundHandlerCoverage[], totals: PlaygroundDiagnosticsTotals) {
    handlerCoverage.value = handlers.map(handler => ({ ...handler }))
    coverageTotals.value = { ...totals }
  }

  function applyScenario(scenario: PlaygroundScenario | undefined) {
    if (!scenario) {
      scenarioNames.value = []
      activeScenario.value = ''
      return
    }
    scenarioNames.value = [...scenario.names]
    activeScenario.value = scenario.active
    scenarioError.value = ''
  }

  function handleWsMessage(event: MessageEvent) {
    if (typeof event.data !== 'string') {
      return
    }
    const parsed = parseWsMessage(event.data)
    if (!parsed) {
      return
    }
    if (parsed.type === 'snapshot') {
      routeCounts.value = { ...parsed.perRoute }
      applyScenario(parsed.scenario)
      const diagnostics = parsed.diagnostics
      if (!diagnostics) {
        return
      }
      applyCoverage(diagnostics.handlers, diagnostics.totals)
      for (const entry of diagnostics.timeline) {
        appendServerDiagnostic({ type: 'diagnostic', entry, handlers: diagnostics.handlers, totals: diagnostics.totals })
      }
      return
    }
    if (parsed.type === 'diagnostic') {
      applyCoverage(parsed.handlers, parsed.totals)
      appendServerDiagnostic(parsed)
      return
    }
    if (parsed.type === 'scenario') {
      applyScenario(parsed.scenario)
      return
    }
    if (parsed.type === 'scenario:error') {
      scenarioError.value = parsed.message
      return
    }
    routeCounts.value[parsed.routeKey] = (routeCounts.value[parsed.routeKey] ?? 0) + 1
  }

  function cleanupWebSocket() {
    if (wsRef.value) {
      wsRef.value.close()
      wsRef.value = null
    }
    wsUrlRef.value = ''
    isServerCounts.value = false
    applyScenario(undefined)
  }

  function sendScenario(action: 'select' | 'reset', name?: string) {
    const socket = wsRef.value
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      scenarioError.value = 'Playground WebSocket is not connected.'
      return
    }
    scenarioError.value = ''
    socket.send(JSON.stringify({ type: 'scenario', action, ...(name === undefined ? {} : { name }) }))
  }

  function connectWebSocket(basePath: string) {
    if (typeof window === 'undefined') {
      return
    }
    const url = resolvePlaygroundWsUrl(basePath)
    if (!url || wsUrlRef.value === url) {
      return
    }
    cleanupWebSocket()
    wsUrlRef.value = url
    try {
      const socket = new WebSocket(url)
      wsRef.value = socket
      socket.addEventListener('open', () => {
        isServerCounts.value = true
      })
      socket.addEventListener('message', handleWsMessage)
      socket.addEventListener('close', () => {
        if (wsRef.value === socket) {
          cleanupWebSocket()
        }
      })
      socket.addEventListener('error', () => {
        if (wsRef.value === socket) {
          cleanupWebSocket()
        }
      })
    }
    catch {
      cleanupWebSocket()
    }
  }

  function setParamValue(name: string, value: string) {
    paramValues.value = {
      ...paramValues.value,
      [name]: value,
    }
    if (!value.trim()) {
      return
    }
    if (!missingParams.value.includes(name)) {
      return
    }
    missingParams.value = missingParams.value.filter(param => param !== name)
  }

  function syncRouteParams(route: PlaygroundRoute | null) {
    missingParams.value = []
    missingPulse.value = 0
    if (!route) {
      routeTokens.value = []
      routeParams.value = []
      paramValues.value = {}
      return
    }
    const parsed = parseRouteTemplate(route.url)
    routeTokens.value = parsed.tokens
    const nextParams = buildRouteParams(parsed.tokens)
    const nextValues: Record<string, string> = {}
    for (const param of nextParams) {
      nextValues[param.name] = paramValues.value[param.name] ?? ''
    }
    routeParams.value = nextParams
    paramValues.value = nextValues
  }

  async function ensureSwReady() {
    if (isSwReady.value) {
      return true
    }
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return false
    }
    let nextReadyPromise: Promise<void> | null = null
    if (!swReadyPromise) {
      nextReadyPromise = navigator.serviceWorker.ready
        .then(() => {
          isSwReady.value = true
        })
        .catch(() => {
          swReadyPromise = null
        })
    }
    const controller = navigator.serviceWorker.controller
    if (isMokupController(controller)) {
      isSwMode.value = true
      isSwReady.value = true
      return true
    }
    if (!isSwMode.value) {
      const registration = await resolveMokupRegistration()
      if (!registration) {
        return false
      }
      isSwMode.value = true
    }
    if (!swReadyPromise && nextReadyPromise) {
      swReadyPromise = nextReadyPromise
    }
    await swReadyPromise
    return isSwReady.value
  }

  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    ensureSwReady().catch(() => undefined)
  }

  if (options.basePath) {
    watch(
      options.basePath,
      (value) => {
        if (value) {
          connectWebSocket(value)
        }
      },
      { immediate: true },
    )
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      cleanupWebSocket()
    })
  }

  const { resetResponse, runRequest } = createRequestRunner({
    t,
    selected,
    routeTokens,
    paramValues,
    ...requestPayloadState,
    ...authState,
    ...responseState,
    routeCounts,
    isServerCounts,
    ensureSwReady,
    getRouteKey,
    onRequestSettled: (entry) => {
      requestHistory.value = [{ ...entry, id: ++historyId }, ...requestHistory.value].slice(0, 50)
    },
    onMissingParams: (missing) => {
      missingParams.value = [...missing]
      missingPulse.value += 1
    },
  })

  watch(selected, () => {
    resetResponse()
    syncRouteParams(selected.value)
  })

  return {
    ...requestPayloadState,
    ...authState,
    ...responseState,
    resetResponse,
    runRequest,
    isSwMode,
    isSwRegistering,
    routeParams,
    paramValues,
    missingParams,
    missingPulse,
    setParamValue,
    requestUrl,
    routeCounts,
    totalCount,
    getRouteCount,
    scenarioNames,
    activeScenario,
    scenarioError,
    selectScenario: (name: string) => sendScenario('select', name),
    resetScenario: () => sendScenario('reset'),
  }
}
