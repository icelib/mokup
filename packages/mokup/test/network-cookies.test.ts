import { createMockSession, http, HttpResponse, passthrough } from '@mokup/runtime/http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserCookies } from '../src/network/browser-cookies'

const page = 'https://app.example.test'
const request = (path = '/', init?: RequestInit) => new Request(new URL(path, page), init)
const response = (...cookies: string[]) => new HttpResponse(null, { headers: cookies.map((value): [string, string] => ['set-cookie', value]) })

describe('browser virtual cookies', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function setup() {
    vi.stubGlobal('location', new URL(`${page}/screen`))
    vi.stubGlobal('document', { cookie: 'visible=page; encoded=a%3Db' })
    return createBrowserCookies()
  }

  it('reads visible document cookies only for the exact page origin and allowed credentials', () => {
    const jar = setup()
    expect(jar.cookiesFor(request())).toEqual({ visible: 'page', encoded: 'a=b' })
    expect(jar.cookiesFor(request('/', { credentials: 'omit' }))).toEqual({})
    expect(jar.cookiesFor(request('https://api.example.test/', { credentials: 'include' }))).toEqual({})
    expect(jar.cookiesFor(request('https://unrelated.test/', { credentials: 'include' }))).toEqual({})
  })

  it('enforces virtual domain and path scope, including default paths and duplicate names', () => {
    const jar = setup()
    jar.store(request('/auth/login'), response(
      'default_path=1',
      'token=root; Path=/',
      'token=auth; Path=/auth',
      'parent=1; Domain=example.test; Path=/',
      'host_only=1; Path=/',
      'invalid=1; Domain=unrelated.test; Path=/',
      'suffix=1; Domain=test; Path=/',
    ))
    expect(jar.cookiesFor(request('/auth/profile'))).toMatchObject({ default_path: '1', token: 'auth', parent: '1', host_only: '1' })
    expect(jar.cookiesFor(request('/authentication'))).not.toHaveProperty('default_path')
    expect(jar.cookiesFor(request('/authentication'))).toHaveProperty('token', 'root')
    expect(jar.cookiesFor(request('https://api.example.test/', { credentials: 'include' }))).toEqual({ parent: '1' })
    expect(jar.cookiesFor(request('https://api.example.test/'))).toEqual({})
    expect(jar.cookiesFor(request('/'))).not.toHaveProperty('invalid')
    expect(jar.cookiesFor(request('/'))).not.toHaveProperty('suffix')
  })

  it('expires cookies, honors Max-Age precedence, and supports deletion', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'))
    const jar = setup()
    jar.store(request(), response(
      'short=1; Max-Age=1',
      'expired=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'deleted=1',
    ))
    expect(jar.cookiesFor(request())).toHaveProperty('short', '1')
    expect(jar.cookiesFor(request())).not.toHaveProperty('expired')
    jar.store(request(), response('deleted=; Max-Age=0; Expires=Mon, 21 Oct 2030 07:28:00 GMT'))
    expect(jar.cookiesFor(request())).not.toHaveProperty('deleted')
    vi.setSystemTime(new Date('2026-10-05T00:00:02Z'))
    expect(jar.cookiesFor(request())).not.toHaveProperty('short')
  })

  it('requires Secure for SameSite=None and excludes secure cookies from insecure requests', () => {
    const jar = setup()
    jar.store(request(), response('secure=1; Secure; SameSite=None', 'invalid=1; SameSite=None'))
    expect(jar.cookiesFor(request())).toHaveProperty('secure', '1')
    expect(jar.cookiesFor(request())).not.toHaveProperty('invalid')
    expect(jar.cookiesFor(request('http://app.example.test/', { credentials: 'include' }))).toEqual({})
    jar.store(request('http://app.example.test/', { credentials: 'include' }), response('insecure_set=1; Secure; SameSite=None'))
    expect(jar.cookiesFor(request())).not.toHaveProperty('insecure_set')
  })

  it('applies schemeful SameSite and never saves cookies from omitted or cross-origin default credentials', () => {
    const jar = setup()
    const target = 'https://api.other.test/'
    jar.store(request(target, { credentials: 'include' }), response(
      'none=1; Secure; SameSite=None',
      'strict=1; Secure; SameSite=Strict',
      'lax=1; Secure; SameSite=Lax',
      'default_lax=1; Secure',
    ))
    expect(jar.cookiesFor(request(target, { credentials: 'include' }))).toEqual({ none: '1' })
    expect(jar.cookiesFor(request(target))).toEqual({})
    expect(jar.cookiesFor(request(target, { credentials: 'omit' }))).toEqual({})
    jar.store(request(target), response('default_credentials=1; Secure; SameSite=None'))
    jar.store(request('/', { credentials: 'omit' }), response('omitted=1'))
    expect(jar.cookiesFor(request(target, { credentials: 'include' }))).not.toHaveProperty('default_credentials')
    expect(jar.cookiesFor(request())).not.toHaveProperty('omitted')
  })

  it('isolates owners and clears virtual HttpOnly cookies without changing document cookies', () => {
    const first = setup()
    const second = createBrowserCookies()
    first.store(request(), response('virtual_session=first; HttpOnly; Secure'))
    expect(first.cookiesFor(request())).toHaveProperty('virtual_session', 'first')
    expect(second.cookiesFor(request())).not.toHaveProperty('virtual_session')
    expect(document.cookie).toBe('visible=page; encoded=a%3Db')
    first.clear()
    expect(first.cookiesFor(request())).toEqual({})
    first.store(request(), response('late=ignored'))
    expect(first.cookiesFor(request())).toEqual({})
  })

  it('adds only transport cookie metadata and leaves passthrough headers and body intact', async () => {
    const jar = setup()
    const seen: unknown[] = []
    const session = createMockSession(http.post('/pass', async ({ request, cookies }) => {
      seen.push(cookies)
      await request.text()
      return passthrough()
    }))
    try {
      const original = request('/pass', { method: 'POST', body: 'original body' })
      expect(await jar.wrap(session).handle(original)).toBeUndefined()
      expect(seen).toEqual([{ visible: 'page', encoded: 'a=b' }])
      expect(original.headers.get('cookie')).toBeNull()
      expect(original.bodyUsed).toBe(false)
      expect(await original.text()).toBe('original body')
    }
    finally {
      jar.clear()
      await session.dispose()
    }
  })
})
