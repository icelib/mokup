import type { PlaygroundOptionsInput } from '../shared/types'

interface PlaygroundConfig {
  enabled: boolean
  path: string
  build: boolean
}

function normalizePlaygroundPath(value?: string) {
  if (!value) {
    return '/__mokup'
  }
  const normalized = value.startsWith('/') ? value : `/${value}`
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

function normalizeBase(base: string) {
  if (!base || base === '/') {
    return ''
  }
  return base.endsWith('/') ? base.slice(0, -1) : base
}

function resolvePlaygroundRequestPath(base: string, playgroundPath: string) {
  const normalizedBase = normalizeBase(base)
  const normalizedPath = normalizePlaygroundPath(playgroundPath)
  if (!normalizedBase) {
    return normalizedPath
  }
  if (normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`)) {
    return normalizedPath
  }
  return `${normalizedBase}${normalizedPath}`
}

function matchPlaygroundRequestPath(pathname: string, base: string, playgroundPath: string) {
  const candidates = [resolvePlaygroundRequestPath(base, playgroundPath), playgroundPath]
  for (const candidate of candidates) {
    const mountPath = normalizePlaygroundPath(candidate)
    const prefix = mountPath === '/' ? '' : mountPath
    if (pathname === mountPath || pathname.startsWith(`${prefix}/`)) {
      return { mountPath, subPath: pathname.slice(prefix.length) }
    }
  }
  return null
}

/**
 * Normalize playground configuration to enabled/path values.
 *
 * @param playground - Playground options input.
 * @returns Normalized playground config.
 *
 * @example
 * import { resolvePlaygroundOptions } from 'mokup/vite'
 *
 * const config = resolvePlaygroundOptions(true)
 */
export function resolvePlaygroundOptions(
  playground: PlaygroundOptionsInput,
): PlaygroundConfig {
  if (playground === false) {
    return { enabled: false, path: '/__mokup', build: false }
  }
  if (playground && typeof playground === 'object') {
    return {
      enabled: playground.enabled !== false,
      path: normalizePlaygroundPath(playground.path),
      build: playground.build === true,
    }
  }
  return { enabled: true, path: '/__mokup', build: false }
}

export type { PlaygroundConfig }
export {
  matchPlaygroundRequestPath,
  normalizeBase,
  normalizePlaygroundPath,
  resolvePlaygroundRequestPath,
}
