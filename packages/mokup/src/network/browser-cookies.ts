import type { HttpCookies, MockSession } from '@mokup/runtime/http'
import { getResponseCookies } from '@mokup/runtime/http'
import { Cookie, CookieJar, getPublicSuffix } from 'tough-cookie'

function decode(value: string) {
  try {
    return decodeURIComponent(value)
  }
  catch {
    return value
  }
}

function site(url: URL) {
  const domain = getPublicSuffix(url.hostname, { allowSpecialUseDomain: true, ignoreError: true }) ?? url.hostname
  return `${url.protocol}//${domain}`
}

function isSecure(url: URL) {
  return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
    || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
}

/** Virtual HTTP cookies live only as long as their browser mock owner. */
export function createBrowserCookies() {
  const jar = new CookieJar()
  let closed = false

  function context(request: Request) {
    if (closed || request.credentials === 'omit' || !globalThis.location) {
      return undefined
    }
    const page = new URL(location.href)
    const url = new URL(request.url)
    const sameOrigin = url.origin === page.origin
    if (request.credentials === 'same-origin' && !sameOrigin) {
      return undefined
    }
    return { url, sameOrigin, sameSiteContext: site(url) === site(page) ? 'strict' as const : 'none' as const }
  }

  function cookiesFor(request: Request): HttpCookies {
    const result: HttpCookies = Object.create(null)
    const target = context(request)
    if (!target) {
      return result
    }
    // Document cookies reveal no Path/Domain attributes. Only copy cookies
    // currently visible to this page, and only to its exact origin.
    if (target.sameOrigin && globalThis.document) {
      for (const value of document.cookie.split(';')) {
        const cookie = Cookie.parse(value.trim())
        if (cookie && !Object.hasOwn(result, cookie.key)) {
          result[cookie.key] = decode(cookie.value)
        }
      }
    }
    const virtual: HttpCookies = Object.create(null)
    for (const cookie of jar.getCookiesSync(target.url.href, { sameSiteContext: target.sameSiteContext })) {
      // The jar sorts the most specific path first, as real Cookie headers do.
      if (!Object.hasOwn(virtual, cookie.key)) {
        virtual[cookie.key] = decode(cookie.value)
      }
    }
    return { ...result, ...virtual }
  }

  function store(request: Request, response: Response) {
    const target = context(request)
    if (!target) {
      return
    }
    for (const value of getResponseCookies(response)) {
      const cookie = Cookie.parse(value)
      if (!cookie || (cookie.secure && !isSecure(target.url)) || (cookie.sameSite === 'none' && !cookie.secure)) {
        continue
      }
      // Modern subresource requests default unspecified SameSite to Lax.
      cookie.sameSite ??= 'lax'
      jar.setCookieSync(cookie, target.url.href, { ignoreError: true, sameSiteContext: target.sameSiteContext })
    }
  }

  return {
    cookiesFor,
    store,
    wrap(session: MockSession): MockSession {
      return {
        ...session,
        async handle(request, metadata) {
          const response = await session.handle(request, {
            ...metadata,
            cookies: { ...cookiesFor(request), ...metadata?.cookies },
          })
          if (response) {
            store(request, response)
          }
          return response
        },
      }
    },
    clear() {
      closed = true
      jar.removeAllCookiesSync()
    },
  }
}
