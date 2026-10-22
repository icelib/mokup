const responseCookies = new WeakMap<Response, readonly string[]>()

/** Read cookies retained by HttpResponse even when a browser filters Set-Cookie headers. */
export function getResponseCookies(response: Response): string[] {
  return [...responseCookies.get(response) ?? response.headers.getSetCookie?.() ?? []]
}

export function captureResponseCookies(response: Response, headers?: HeadersInit): void {
  if (headers) {
    const cookies = new Headers(headers).getSetCookie()
    if (cookies.length && cookies.join('\n') !== response.headers.getSetCookie().join('\n')) {
      responseCookies.set(response, cookies)
    }
  }
}

/** Preserve hidden cookies when rebuilding a response, honoring explicit header overrides. */
export function copyResponseCookies(source: Response, target: Response, overrides?: HeadersInit): Response {
  const headers = new Headers(overrides)
  const cookies = headers.has('set-cookie') ? headers.getSetCookie() : getResponseCookies(source)
  if (cookies.length && cookies.join('\n') !== target.headers.getSetCookie().join('\n')) {
    responseCookies.set(target, cookies)
  }
  else {
    responseCookies.delete(target)
  }
  return target
}
