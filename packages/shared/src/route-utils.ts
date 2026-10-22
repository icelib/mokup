import { toPosix } from './path-utils'
import { basename, dirname, extname, join, relative } from './pathe'
import { jsonExtensions, methodSuffixSet } from './route-constants'
import { normalizePrefix } from './scan-utils'

export interface RouteParserResult<TToken = unknown> {
  template: string
  tokens: TToken[]
  score: number[]
  errors: string[]
  warnings: string[]
}

export type RouteParser<TToken = unknown> = (template: string) => RouteParserResult<TToken>

export type RouteScoreComparator = (a: number[], b: number[]) => number

export interface DerivedRoute<TToken = unknown, TMethod extends string = string> {
  template: string
  method: TMethod
  tokens: TToken[]
  score: number[]
}

export function createRouteUtils<
  TToken = unknown,
  TRule extends { handler: unknown } = { handler: unknown },
  TMethod extends string = string,
>(params: {
  parseRouteTemplate: RouteParser<TToken>
  compareRouteScore: RouteScoreComparator
}) {
  const { parseRouteTemplate, compareRouteScore } = params

  function resolveTemplate(template: string, prefix: string) {
    const normalized = template.startsWith('/') ? template : `/${template}`
    if (!prefix) {
      return normalized
    }
    const normalizedPrefix = normalizePrefix(prefix)
    if (!normalizedPrefix) {
      return normalized
    }
    if (
      normalized === normalizedPrefix
      || normalized.startsWith(`${normalizedPrefix}/`)
    ) {
      return normalized
    }
    if (normalized === '/') {
      return `${normalizedPrefix}/`
    }
    return `${normalizedPrefix}${normalized}`
  }

  function stripMethodSuffix(base: string) {
    const segments = base.split('.')
    const last = segments.at(-1)
    if (last && methodSuffixSet.has(last.toLowerCase())) {
      segments.pop()
      return {
        name: segments.join('.'),
        method: last.toUpperCase(),
      }
    }
    return {
      name: base,
      method: undefined,
    }
  }

  function deriveRouteFromFile(
    file: string,
    rootDir: string,
    warn?: (message: string) => void,
  ): DerivedRoute<TToken, TMethod> | null {
    const rel = toPosix(relative(rootDir, file))
    const ext = extname(rel)
    const withoutExt = rel.slice(0, rel.length - ext.length)
    const dir = dirname(withoutExt)
    const base = basename(withoutExt)
    const { name, method } = stripMethodSuffix(base)
    const resolvedMethod = (method ?? (jsonExtensions.has(ext) ? 'GET' : undefined)) as
      | TMethod
      | undefined
    if (!resolvedMethod) {
      warn?.(`Skip mock without method suffix: ${file}`)
      return null
    }
    if (!name) {
      warn?.(`Skip mock with empty route name: ${file}`)
      return null
    }
    const joined = dir === '.' ? name : join(dir, name)
    const segments = toPosix(joined).split('/')
    if (segments.at(-1) === 'index') {
      segments.pop()
    }
    const template = segments.length === 0 ? '/' : `/${segments.join('/')}`
    const parsed = parseRouteTemplate(template)
    if (parsed.errors.length > 0) {
      for (const error of parsed.errors) {
        warn?.(`${error} in ${file}`)
      }
      return null
    }
    for (const warning of parsed.warnings) {
      warn?.(`${warning} in ${file}`)
    }
    return {
      template: parsed.template,
      method: resolvedMethod,
      tokens: parsed.tokens,
      score: parsed.score,
    }
  }

  function resolveRule<TOutput = DerivedRoute<TToken, TMethod>>(input: {
    rule: TRule
    derivedTemplate: string
    derivedMethod?: TMethod | undefined
    prefix: string
    file: string
    warn?: (message: string) => void
    build?: (base: DerivedRoute<TToken, TMethod>, rule: TRule) => TOutput
  }): TOutput | null {
    const rule = input.rule
    const handlerType = 'handlerType' in rule ? rule.handlerType : undefined
    if ((handlerType !== undefined && handlerType !== 'hono' && handlerType !== 'http')
      || (handlerType === 'http' && typeof rule.handler !== 'function')
      || ('once' in rule && rule.once !== undefined && typeof rule.once !== 'boolean')) {
      input.warn?.(`Skip mock with invalid handlerType, native resolver or once metadata: ${input.file}`)
      return null
    }
    const method = input.derivedMethod
    if (!method) {
      input.warn?.(`Skip mock without method suffix: ${input.file}`)
      return null
    }
    const template = resolveTemplate(input.derivedTemplate, input.prefix)
    const parsed = parseRouteTemplate(template)
    if (parsed.errors.length > 0) {
      for (const error of parsed.errors) {
        input.warn?.(`${error} in ${input.file}`)
      }
      return null
    }
    for (const warning of parsed.warnings) {
      input.warn?.(`${warning} in ${input.file}`)
    }
    const base: DerivedRoute<TToken, TMethod> = {
      template: parsed.template,
      method,
      tokens: parsed.tokens,
      score: parsed.score,
    }
    return input.build ? input.build(base, input.rule) : (base as unknown as TOutput)
  }

  function sortRoutes<TRoute extends { method: string, score: number[], template: string }>(
    routes: TRoute[],
  ) {
    return routes.sort((a, b) => {
      if (a.method !== b.method) {
        return a.method.localeCompare(b.method)
      }
      const scoreCompare = compareRouteScore(a.score, b.score)
      if (scoreCompare !== 0) {
        return scoreCompare
      }
      return a.template.localeCompare(b.template)
    })
  }

  return {
    deriveRouteFromFile,
    resolveRule,
    sortRoutes,
  }
}
