import type { HttpCookies, HttpHandler, HttpMatcher, HttpParams, HttpPredicate } from './types'
import { matchPattern } from '@msw/url'
import { withRequestSignal } from './request'

type CompiledMatcher = (request: Request) => HttpParams | null

const compiledMatchers = new WeakMap<HttpHandler, {
  matcher: HttpMatcher
  source?: string
  flags?: string
  match: CompiledMatcher
}>()
const requestUrls = new WeakMap<Request, URL>()
const urlPredicates = new WeakMap<HttpPredicate, CompiledMatcher>()

function requestUrl(request: Request) {
  let url = requestUrls.get(request)
  if (!url) {
    url = new URL(request.url)
    requestUrls.set(request, url)
  }
  return url
}

/** Internal route predicates only inspect URLs; unlike user predicates they need no body clone. */
export function createUrlPredicate(match: CompiledMatcher): HttpPredicate {
  const predicate: HttpPredicate = ({ request }) => {
    const params = match(request)
    return params ? { matches: true, params } : false
  }
  urlPredicates.set(predicate, match)
  return predicate
}

export function needsPredicateBody(handler: HttpHandler): boolean {
  return typeof handler.matcher === 'function' && !urlPredicates.has(handler.matcher)
}

export function matchesMethod(handler: HttpHandler, method: string): boolean {
  return handler.method instanceof RegExp
    ? new RegExp(handler.method.source, handler.method.flags).test(method)
    : handler.method === '*' || handler.method.toUpperCase() === method.toUpperCase()
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  }
  catch {
    return value
  }
}

export function readCookies(request: Request): HttpCookies {
  const cookies: HttpCookies = Object.create(null)
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) {
      continue
    }
    const name = part.slice(0, separator).trim()
    if (name && !Object.hasOwn(cookies, name)) {
      cookies[name] = decode(part.slice(separator + 1).trim())
    }
  }
  return cookies
}

function cleanMask(matcher: string): string {
  // Consume parameter modifiers before locating query/hash delimiters. A plain
  // split on "?" would destroy optional parameters, including middle segments.
  for (const token of matcher.matchAll(/\\.|:[A-Z_]\w*(?:\?(?=$|[/#?.-])|[*+])?|[?#]/gi)) {
    if (token[0] === '?' || token[0] === '#') {
      return matcher.slice(0, token.index)
    }
  }
  return matcher
}

function compileString(matcher: string, relativeUrls: 'pathname' | 'page' = 'pathname'): CompiledMatcher {
  if (matcher === '*') {
    return () => ({})
  }
  const mask = cleanMask(matcher)
  const absolute = /^[a-z][\w+.-]*:\/\//i.test(mask) || mask.startsWith('*')
  const stars = Array.from(mask.matchAll(/\\.|:[A-Z_]\w*[?*+]?|\*/gi)).filter(token => token[0] === '*').length
  let lastBase: string | undefined
  let pattern = absolute || mask.startsWith('/') ? mask : `/${mask}`
  return (request) => {
    const url = requestUrl(request)
    const base = !absolute && typeof location !== 'undefined' ? location.href : undefined
    if (base !== lastBase) {
      // Escaping protects optional modifiers and pattern escapes from URL parsing.
      pattern = base ? decodeURI(new URL(encodeURI(mask), base).href) : mask.startsWith('/') ? mask : `/${mask}`
      lastBase = base
    }
    const matched = matchPattern(pattern, absolute || base || relativeUrls === 'page' ? `${url.origin}${url.pathname}` : url.pathname)
    if (!matched.matches) {
      return null
    }
    // Keep the original anonymous-glob alias alongside MSW's numeric captures.
    return stars ? { ...matched.params, '*': matched.params[String(stars - 1)] ?? '' } : matched.params
  }
}

function compileRegExp(matcher: RegExp): CompiledMatcher {
  // Reuse a private expression while leaving the caller's lastIndex untouched.
  const pattern = new RegExp(matcher.source, matcher.flags)
  return (request) => {
    pattern.lastIndex = 0
    const url = requestUrl(request)
    const matched = pattern.exec(`${url.origin}${url.pathname}`)
    if (!matched) {
      return null
    }
    return {
      ...Object.fromEntries(matched.slice(1).map((value, index) => [String(index), decode(value ?? '')])),
      ...Object.fromEntries(Object.entries(matched.groups ?? {}).map(([name, value]) => [name, decode(value)])),
    }
  }
}

export function matchHandler(handler: HttpHandler, request: Request, cookies: HttpCookies, signal = request.signal, basePath?: string): HttpParams | null | Promise<HttpParams | null> {
  if (!matchesMethod(handler, request.method)) {
    return null
  }
  const matcher = handler.matcher
  let relativeRequest = request
  if (basePath && basePath !== '/' && (typeof matcher === 'string' || (typeof matcher === 'function' && urlPredicates.has(matcher)))) {
    const url = new URL(request.url)
    const prefix = basePath.replace(/\/$/, '')
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      return null
    }
    if (typeof matcher !== 'string' || !/^[a-z][\w+.-]*:\/\//i.test(matcher)) {
      url.pathname = url.pathname.slice(prefix.length) || '/'
      // Internal URL predicates inspect metadata only and must never tee an upload.
      relativeRequest = new Request(url, { method: request.method, headers: request.headers, signal })
    }
  }
  if (typeof matcher === 'function') {
    const urlPredicate = urlPredicates.get(matcher)
    if (urlPredicate) {
      return urlPredicate(relativeRequest)
    }
    return Promise.resolve(matcher({ request: withRequestSignal(request.clone(), signal), cookies: { ...cookies } })).then(result =>
      typeof result === 'boolean' ? result ? {} : null : result.matches ? result.params ?? {} : null,
    )
  }
  const previous = compiledMatchers.get(handler)
  if (previous?.matcher === matcher && (typeof matcher === 'string' || (previous.source === matcher.source && previous.flags === matcher.flags))) {
    return previous.match(relativeRequest)
  }
  const match = typeof matcher === 'string' ? compileString(matcher, handler.execution?.relativeUrls) : compileRegExp(matcher)
  compiledMatchers.set(handler, { matcher, match, ...(matcher instanceof RegExp ? { source: matcher.source, flags: matcher.flags } : {}) })
  return match(relativeRequest)
}
