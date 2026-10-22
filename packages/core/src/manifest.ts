import type { Manifest, ManifestResponse } from '@mokup/runtime'
import type { ResolvedRoute, RouteTable } from './shared/types'

import { isHttpResponse } from '@mokup/runtime'
import { isAbsolute, relative, resolve } from '@mokup/shared/pathe'
import { toPosix } from './shared/utils'

/**
 * Module kind emitted by the manifest builder.
 *
 * @example
 * import type { ManifestModuleKind } from 'mokup/vite'
 *
 * const kind: ManifestModuleKind = 'rule'
 */
export type ManifestModuleKind = 'rule' | 'middleware'

/**
 * Module entry emitted during manifest build.
 *
 * @example
 * import type { ManifestModuleEntry } from 'mokup/vite'
 *
 * const entry: ManifestModuleEntry = {
 *   id: '/@fs/project/mock/ping.get.ts',
 *   kind: 'rule',
 * }
 */
export interface ManifestModuleEntry {
  id: string
  kind: ManifestModuleKind
}

/**
 * Result of building a manifest from routes.
 *
 * @example
 * import type { ManifestBuildResult } from 'mokup/vite'
 *
 * const result: ManifestBuildResult = {
 *   manifest: { version: 1, routes: [] },
 *   modules: [],
 * }
 */
export interface ManifestBuildResult {
  manifest: Manifest
  modules: ManifestModuleEntry[]
}

/**
 * Convert a file path to a Vite import path.
 *
 * @param file - File path to convert.
 * @param root - Project root.
 * @returns Vite-compatible import path.
 *
 * @example
 * import { toViteImportPath } from 'mokup/vite'
 *
 * const id = toViteImportPath('mock/ping.get.ts', process.cwd())
 */
export function toViteImportPath(file: string, root: string) {
  const absolute = isAbsolute(file) ? file : resolve(root, file)
  const rel = relative(root, absolute)
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    return `/${toPosix(rel)}`
  }
  return `/@fs/${toPosix(absolute)}`
}

function shouldModuleize(handler: ResolvedRoute['handler']) {
  if (typeof handler === 'function') {
    return true
  }
  if (isHttpResponse(handler)) {
    return true
  }
  return false
}

const BASE64_ALPHABET
  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function getNodeBuffer() {
  if (typeof globalThis === 'undefined') {
    return null
  }
  // eslint-disable-next-line node/prefer-global/buffer
  const buffer = (globalThis as {
    Buffer?: {
      from: (data: Uint8Array) => { toString: (encoding: 'base64') => string }
    }
  }).Buffer
  return buffer ?? null
}

function getBtoa() {
  if (typeof globalThis === 'undefined') {
    return null
  }
  const btoaFn = (globalThis as { btoa?: (data: string) => string }).btoa
  return typeof btoaFn === 'function' ? btoaFn : null
}

function encodeBase64(bytes: Uint8Array) {
  const buffer = getNodeBuffer()
  if (buffer) {
    return buffer.from(bytes).toString('base64')
  }
  const btoaFn = getBtoa()
  if (btoaFn) {
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize)
      binary += String.fromCharCode(...chunk)
    }
    return btoaFn(binary)
  }
  let output = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0
    const c = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0
    const triple = (a << 16) | (b << 8) | c
    output += BASE64_ALPHABET[(triple >> 18) & 63]
    output += BASE64_ALPHABET[(triple >> 12) & 63]
    output += i + 1 < bytes.length
      ? BASE64_ALPHABET[(triple >> 6) & 63]
      : '='
    output += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 63] : '='
  }
  return output
}

function toBinaryBody(handler: ResolvedRoute['handler']) {
  if (handler instanceof ArrayBuffer) {
    return encodeBase64(new Uint8Array(handler))
  }
  if (handler instanceof Uint8Array) {
    return encodeBase64(handler)
  }
  return null
}

function buildManifestResponse(
  route: ResolvedRoute,
  moduleId: string | null,
): ManifestResponse {
  if (moduleId) {
    const response: {
      type: 'module'
      module: string
      ruleIndex?: number
    } = {
      type: 'module',
      module: moduleId,
    }
    if (typeof route.ruleIndex === 'number') {
      response.ruleIndex = route.ruleIndex
    }
    return response
  }
  const handler = route.handler
  if (typeof handler === 'string') {
    return {
      type: 'text',
      body: handler,
    }
  }
  const binary = toBinaryBody(handler)
  if (binary) {
    return {
      type: 'binary',
      body: binary,
      encoding: 'base64',
    }
  }
  return {
    type: 'json',
    body: handler,
  }
}

/**
 * Build manifest data and module entries from resolved routes.
 *
 * @param params - Build inputs.
 * @param params.routes - Resolved routes to serialize.
 * @param params.root - Workspace root path.
 * @param params.resolveModulePath - Optional module resolver.
 * @returns Manifest and module entries.
 *
 * @example
 * import { buildManifestData } from 'mokup/vite'
 *
 * const { manifest } = buildManifestData({ routes: [], root: process.cwd() })
 */
export function buildManifestData(params: {
  routes: RouteTable
  root: string
  resolveModulePath?: (file: string, root: string) => string
}): ManifestBuildResult {
  const { routes, root } = params
  const resolveModulePath = params.resolveModulePath ?? toViteImportPath
  const ruleModules = new Map<string, ManifestModuleEntry>()
  const middlewareModules = new Map<string, ManifestModuleEntry>()

  const manifestRoutes = routes.map((route) => {
    const moduleId = shouldModuleize(route.handler)
      ? resolveModulePath(route.file, root)
      : null

    if (moduleId && !ruleModules.has(moduleId)) {
      ruleModules.set(moduleId, { id: moduleId, kind: 'rule' })
    }

    const middleware = route.middlewares?.map((entry) => {
      const modulePath = resolveModulePath(entry.source, root)
      if (!middlewareModules.has(modulePath)) {
        middlewareModules.set(modulePath, { id: modulePath, kind: 'middleware' })
      }
      return {
        module: modulePath,
        ruleIndex: entry.index,
      }
    })

    const response = buildManifestResponse(route, moduleId)
    const manifestRoute = {
      method: route.method,
      ...(route.handlerType ? { handlerType: route.handlerType } : {}),
      ...(route.once !== undefined ? { once: route.once } : {}),
      url: route.template,
      ...(route.tokens ? { tokens: route.tokens } : {}),
      ...(route.score ? { score: route.score } : {}),
      ...(route.status ? { status: route.status } : {}),
      ...(route.headers ? { headers: route.headers } : {}),
      ...(route.delay ? { delay: route.delay } : {}),
      ...(middleware && middleware.length > 0 ? { middleware } : {}),
      response,
    }

    return manifestRoute
  })

  const manifest: Manifest = {
    version: 1,
    routes: manifestRoutes,
  }

  return {
    manifest,
    modules: [
      ...ruleModules.values(),
      ...middlewareModules.values(),
    ],
  }
}
