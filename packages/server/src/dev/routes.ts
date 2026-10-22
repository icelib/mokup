import type { RouteToken } from '@mokup/runtime'
import type { FileRouteRule, HttpMethod, ResolvedRoute } from './types'

import { compareRouteScore, parseRouteTemplate } from '@mokup/runtime'
import { createRouteUtils } from '@mokup/shared/route-utils'

/**
 * Derive route metadata from a file path.
 *
 * @param file - Route file path.
 * @param rootDir - Root directory for routing.
 * @param logger - Logger for warnings.
 * @param logger.warn - Warning logger.
 * @returns Parsed route info or null when invalid.
 *
 * @example
 * import { deriveRouteFromFile } from '@mokup/server'
 *
 * const route = deriveRouteFromFile('/project/mock/ping.get.ts', '/project/mock', console)
 */
const routeUtils = createRouteUtils<RouteToken, FileRouteRule, HttpMethod>({
  parseRouteTemplate,
  compareRouteScore,
})

export function deriveRouteFromFile(
  file: string,
  rootDir: string,
  logger: { warn: (...args: unknown[]) => void },
) {
  return routeUtils.deriveRouteFromFile(file, rootDir, message => logger.warn(message))
}

/**
 * Resolve a route rule into a normalized route entry.
 *
 * @param params - Rule and derived route inputs.
 * @param params.rule - Rule definition.
 * @param params.derivedTemplate - Derived route template.
 * @param params.derivedMethod - Derived HTTP method.
 * @param params.prefix - URL prefix to apply.
 * @param params.file - Source file path.
 * @param params.logger - Logger for warnings.
 * @param params.logger.warn - Warning logger.
 * @returns A resolved route or null when invalid.
 *
 * @example
 * import { resolveRule } from '@mokup/server'
 *
 * const resolved = resolveRule({
 *   rule: { handler: () => ({ ok: true }) },
 *   derivedTemplate: '/ping',
 *   derivedMethod: 'GET',
 *   prefix: '/api',
 *   file: '/project/mock/ping.get.ts',
 *   logger: console,
 * })
 */
export function resolveRule(params: {
  rule: FileRouteRule
  derivedTemplate: string
  derivedMethod?: HttpMethod
  prefix: string
  file: string
  logger: { warn: (...args: unknown[]) => void }
}): ResolvedRoute | null {
  return routeUtils.resolveRule<ResolvedRoute>({
    rule: params.rule,
    derivedTemplate: params.derivedTemplate,
    derivedMethod: params.derivedMethod,
    prefix: params.prefix,
    file: params.file,
    warn: message => params.logger.warn(message),
    build: (base, rule) => {
      const route: ResolvedRoute = {
        file: params.file,
        template: base.template,
        method: base.method as HttpMethod,
        tokens: base.tokens,
        score: base.score,
        handler: rule.handler,
        ...(rule.handlerType ? { handlerType: rule.handlerType } : {}),
        ...(rule.once !== undefined ? { once: rule.once } : {}),
      }
      if (typeof rule.status === 'number') {
        route.status = rule.status
      }
      if (rule.headers) {
        route.headers = rule.headers
      }
      if (typeof rule.delay === 'number') {
        route.delay = rule.delay
      }
      return route
    },
  })
}

/**
 * Sort routes by method, score, and template.
 *
 * @param routes - Routes to sort (in place).
 * @returns The sorted routes.
 *
 * @example
 * import { sortRoutes } from '@mokup/server'
 *
 * const routes = sortRoutes([])
 */
export function sortRoutes(routes: ResolvedRoute[]) {
  return routeUtils.sortRoutes(routes)
}
