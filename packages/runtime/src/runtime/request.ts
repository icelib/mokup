import type { ManifestRoute, ModuleMap, RuntimeRequest } from '../types'
import { normalizeMethod } from '../normalize'
import { normalizePathname } from '../router'

const EXTERNAL_MODULE_PATH_RE = /^(?:data|http|https|file):/

function appendQueryParams(url: URL, query: RuntimeRequest['query']) {
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        url.searchParams.append(key, entry)
      }
    }
    else {
      url.searchParams.append(key, value)
    }
  }
}

function resolveRequestBody(req: RuntimeRequest, contentType: string) {
  if (typeof req.rawBodyBytes !== 'undefined') {
    return new Uint8Array(req.rawBodyBytes).buffer
  }
  if (typeof req.rawBody !== 'undefined') {
    return req.rawBody
  }
  const body = req.body
  if (typeof body === 'undefined') {
    return undefined
  }
  if (typeof body === 'string') {
    return body
  }
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    return body
  }
  if (typeof body === 'object') {
    const normalized = contentType.toLowerCase()
    if (normalized.includes('json')) {
      return JSON.stringify(body)
    }
    return JSON.stringify(body)
  }
  return String(body)
}

function toFetchRequest(req: RuntimeRequest): Request {
  const url = new URL(normalizePathname(req.path), 'http://mokup.local')
  appendQueryParams(url, req.query)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    headers.set(key, value)
  }

  const method = normalizeMethod(req.method) ?? 'GET'
  const contentType = headers.get('content-type') ?? ''
  const body = resolveRequestBody(req, contentType)

  const init: RequestInit = { method, headers }
  if (typeof body !== 'undefined' && method !== 'GET' && method !== 'HEAD') {
    init.body = body as BodyInit
  }

  return new Request(url.toString(), init)
}

function isRelativeModulePath(modulePath: string) {
  return !EXTERNAL_MODULE_PATH_RE.test(modulePath)
}

function requiresModuleBase(
  modulePath: string,
  moduleMap: ModuleMap | undefined,
) {
  if (!isRelativeModulePath(modulePath)) {
    return false
  }
  if (moduleMap && Object.hasOwn(moduleMap, modulePath)) {
    return false
  }
  return true
}

function routeNeedsModuleBase(route: ManifestRoute, moduleMap: ModuleMap | undefined) {
  if (
    route.response.type === 'module'
    && requiresModuleBase(route.response.module, moduleMap)
  ) {
    return true
  }
  if (route.middleware) {
    for (const middleware of route.middleware) {
      if (requiresModuleBase(middleware.module, moduleMap)) {
        return true
      }
    }
  }
  return false
}

export { routeNeedsModuleBase, toFetchRequest }
