import type { RouteToken } from '@mokup/runtime'
import type { Ref } from 'vue'
import type { ApiKeyLocation, AuthType, BodyType, MultipartFileEntry, PlaygroundRoute, RawBodyType } from '../../types'
import type { RequestHistoryEntry } from './history'
import type { RouteCounts } from './websocket'
import { parseRouteTemplate } from '@mokup/runtime'
import { applyQuery, parseJsonInput } from '../../utils/request'
import { buildResolvedPath } from './params'
import { parseKeyValueInput } from './query'

function createRequestRunner(params: {
  t: (key: string, params?: Record<string, string | number>) => string
  selected: Ref<PlaygroundRoute | null>
  routeTokens: Ref<RouteToken[]>
  paramValues: Ref<Record<string, string>>
  queryText: Ref<string>
  headersText: Ref<string>
  bodyText: Ref<string>
  bodyType: Ref<BodyType>
  rawType: Ref<RawBodyType>
  rawValidate: Ref<boolean>
  multipartFiles?: Ref<MultipartFileEntry[]>
  binaryFile?: Ref<File | null>
  authType?: Ref<AuthType>
  authToken?: Ref<string>
  authUsername?: Ref<string>
  authPassword?: Ref<string>
  authKeyName?: Ref<string>
  authKeyValue?: Ref<string>
  authKeyLocation?: Ref<ApiKeyLocation>
  authCustomName?: Ref<string>
  authCustomValue?: Ref<string>
  responseText?: Ref<string>
  responseRaw?: Ref<string>
  responsePretty?: Ref<string>
  responseHeaders?: Ref<Record<string, string>>
  responseContentType?: Ref<string>
  responseStatus: Ref<string>
  responseTime: Ref<string>
  routeCounts: Ref<RouteCounts>
  isServerCounts: Ref<boolean>
  ensureSwReady: () => Promise<boolean>
  getRouteKey: (route: PlaygroundRoute) => string
  onMissingParams?: (missing: string[]) => void
  onRequestSettled?: (entry: Omit<RequestHistoryEntry, 'id'>) => void
}) {
  const responseTextRef = params.responseText
  const responseRaw = params.responseRaw ?? responseTextRef ?? ({ value: '' } as Ref<string>)
  const responsePretty = params.responsePretty ?? responseTextRef ?? ({ value: '' } as Ref<string>)
  const responseHeaders = params.responseHeaders ?? ({ value: {} } as Ref<Record<string, string>>)
  const responseContentType = params.responseContentType ?? ({ value: '' } as Ref<string>)

  const setResponseRaw = (value: string) => {
    responseRaw.value = value
    if (responseTextRef && responseTextRef !== responseRaw) {
      responseTextRef.value = value
    }
  }

  const setResponsePretty = (value: string) => {
    responsePretty.value = value
    if (responseTextRef && responseTextRef !== responsePretty) {
      responseTextRef.value = value
    }
  }

  const resolveRawContentType = (rawType: RawBodyType) => {
    switch (rawType) {
      case 'javascript':
        return 'application/javascript; charset=utf-8'
      case 'json':
        return 'application/json; charset=utf-8'
      case 'html':
        return 'text/html; charset=utf-8'
      case 'xml':
        return 'text/xml; charset=utf-8'
      default:
        return 'text/plain; charset=utf-8'
    }
  }
  const resetResponse = () => {
    setResponseRaw('')
    setResponsePretty(params.t('response.empty'))
    responseHeaders.value = {}
    responseContentType.value = ''
    params.responseStatus.value = params.t('response.idle')
    params.responseTime.value = ''
  }
  const setErrorResponse = (message: string) => {
    setResponseRaw('')
    setResponsePretty(message)
    responseHeaders.value = {}
    responseContentType.value = ''
    params.responseStatus.value = params.t('response.error')
    params.responseTime.value = ''
  }

  const runRequest = async () => {
    if (!params.selected.value) {
      return
    }
    const tokens = params.routeTokens.value.length > 0
      ? params.routeTokens.value
      : parseRouteTemplate(params.selected.value.url).tokens
    const resolved = buildResolvedPath(tokens, params.paramValues.value)
    if (resolved.missing.length > 0) {
      params.onMissingParams?.(resolved.missing)
      setErrorResponse(params.t('errors.routeParams', { params: resolved.missing.join(', ') }))
      return
    }
    const requestKey = params.getRouteKey(params.selected.value)
    const parsedQuery = parseJsonInput(params.queryText.value)
    if (parsedQuery.error) {
      setErrorResponse(params.t('errors.queryJson', { message: parsedQuery.error }))
      return
    }
    const parsedHeaders = parseJsonInput(params.headersText.value)
    if (parsedHeaders.error) {
      setErrorResponse(params.t('errors.headersJson', { message: parsedHeaders.error }))
      return
    }
    const url = new URL(resolved.path, window.location.origin)
    if (parsedQuery.value) {
      applyQuery(url, parsedQuery.value)
    }

    const headers: Record<string, string> = {}
    if (parsedHeaders.value) {
      for (const [key, value] of Object.entries(parsedHeaders.value)) {
        if (typeof value === 'undefined') {
          continue
        }
        headers[key] = Array.isArray(value) ? value.join(',') : String(value)
      }
    }

    const authMode = params.authType?.value ?? 'none'
    if (authMode === 'bearer') {
      const token = params.authToken?.value ?? ''
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
    }
    else if (authMode === 'basic') {
      const user = params.authUsername?.value ?? ''
      const pass = params.authPassword?.value ?? ''
      if (user || pass) {
        headers['Authorization'] = `Basic ${btoa(`${user}:${pass}`)}`
      }
    }
    else if (authMode === 'apikey') {
      const keyName = params.authKeyName?.value ?? ''
      const keyValue = params.authKeyValue?.value ?? ''
      const keyLocation = params.authKeyLocation?.value ?? 'header'
      if (keyName && keyValue) {
        if (keyLocation === 'query') {
          url.searchParams.set(keyName, keyValue)
        }
        else {
          headers[keyName] = keyValue
        }
      }
    }
    else if (authMode === 'custom') {
      const name = params.authCustomName?.value ?? ''
      const value = params.authCustomValue?.value ?? ''
      if (name) {
        headers[name] = value
      }
    }

    const init: RequestInit = {
      method: params.selected.value.method,
      headers,
      cache: 'no-store',
    }

    const upperMethod = params.selected.value.method.toUpperCase()
    if (upperMethod !== 'GET' && upperMethod !== 'HEAD') {
      const rawBody = params.bodyText.value
      if (params.bodyType.value === 'raw') {
        const trimmed = rawBody.trim()
        if (params.rawType.value === 'json' && params.rawValidate.value) {
          const parsedBody = parseJsonInput(rawBody)
          if (parsedBody.error) {
            setErrorResponse(params.t('errors.bodyJson', { message: parsedBody.error }))
            return
          }
        }
        if (trimmed) {
          init.body = rawBody
          if (!headers['Content-Type']) {
            headers['Content-Type'] = resolveRawContentType(params.rawType.value)
          }
        }
      }
      else if (params.bodyType.value === 'form-urlencoded') {
        const entries = parseKeyValueInput(rawBody)
        if (entries.length > 0) {
          const paramsBody = new URLSearchParams()
          for (const [key, value] of entries) {
            paramsBody.append(key, value)
          }
          init.body = paramsBody.toString()
          if (!headers['Content-Type']) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8'
          }
        }
      }
      else if (params.bodyType.value === 'form-data') {
        const entries = parseKeyValueInput(rawBody)
        const fileEntries = (params.multipartFiles?.value ?? [])
          .map(entry => ({
            name: entry.name.trim(),
            files: entry.files,
          }))
          .filter(entry => entry.name.length > 0 && entry.files.length > 0)
        if (entries.length > 0 || fileEntries.length > 0) {
          const formData = new FormData()
          for (const [key, value] of entries) {
            formData.append(key, value)
          }
          for (const entry of fileEntries) {
            for (const file of entry.files) {
              formData.append(entry.name, file)
            }
          }
          init.body = formData
        }
      }
      else if (params.bodyType.value === 'binary') {
        const file = params.binaryFile?.value ?? null
        if (file) {
          init.body = file
          if (!headers['Content-Type']) {
            headers['Content-Type'] = file.type || 'application/octet-stream'
          }
        }
      }
    }

    params.responseStatus.value = params.t('response.loading')
    params.responseTime.value = ''
    setResponseRaw('')
    setResponsePretty(params.t('response.waiting'))
    responseHeaders.value = {}
    responseContentType.value = ''

    const startedAt = performance.now()
    let status: number | null = null
    let failure: string | undefined
    let responseBody = ''
    try {
      await params.ensureSwReady()
      const response = await fetch(url.toString(), init)
      status = response.status
      if (!params.isServerCounts.value) {
        params.routeCounts.value[requestKey] = (params.routeCounts.value[requestKey] ?? 0) + 1
      }
      const duration = Math.round(performance.now() - startedAt)
      params.responseTime.value = `${duration}ms`
      params.responseStatus.value = `${response.status} ${response.statusText}`
      const headersRecord: Record<string, string> = {}
      if (typeof response.headers?.forEach === 'function') {
        response.headers.forEach((value, key) => {
          headersRecord[key] = value
        })
      }
      responseHeaders.value = headersRecord
      const contentType = response.headers.get('content-type') ?? ''
      responseContentType.value = contentType
      const raw = await response.text()
      responseBody = raw
      setResponseRaw(raw)
      if (contentType.includes('application/json')) {
        try {
          setResponsePretty(JSON.stringify(JSON.parse(raw), null, 2))
        }
        catch {
          setResponsePretty(raw || params.t('response.emptyPayload'))
        }
      }
      else {
        setResponsePretty(raw || params.t('response.emptyPayload'))
      }
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failure = message
      setErrorResponse(message)
    }
    finally {
      params.onRequestSettled?.({
        method: upperMethod,
        path: url.pathname,
        routeKey: requestKey,
        status,
        duration: Math.round(performance.now() - startedAt),
        time: new Date().toISOString(),
        ...(failure ? { error: failure } : {}),
        body: responseBody.slice(0, 65536),
        contentType: responseContentType.value,
        truncated: responseBody.length > 65536,
      })
    }
  }

  return { resetResponse, runRequest }
}

export { createRequestRunner }
