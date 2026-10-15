import type { RouteToken } from '../router'
import type { HttpMethod, Manifest, ManifestRoute } from '../types'
import { normalizeMethod } from '../normalize'
import { compareRouteScore, parseRouteTemplate, scoreRouteTokens } from '../router'

interface CompiledRoute {
  route: ManifestRoute
  method: HttpMethod
  tokens: RouteToken[]
  score: number[]
}

function compileRoutes(manifest: Manifest): CompiledRoute[] {
  const compiled: CompiledRoute[] = []
  for (const route of manifest.routes) {
    const method = normalizeMethod(route.method) ?? 'GET'
    const parsed = route.tokens
      ? {
          tokens: route.tokens,
          score: route.score ?? scoreRouteTokens(route.tokens),
          errors: [] as string[],
        }
      : parseRouteTemplate(route.url)
    if (parsed.errors.length > 0) {
      continue
    }
    compiled.push({
      route,
      method,
      tokens: route.tokens ?? parsed.tokens,
      score: route.score ?? parsed.score,
    })
  }
  return compiled.sort((a, b) => {
    if (a.method !== b.method) {
      return a.method.localeCompare(b.method)
    }
    return compareRouteScore(a.score, b.score)
  })
}

export type { CompiledRoute }
export { compileRoutes }
