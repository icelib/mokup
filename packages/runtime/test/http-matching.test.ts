import { describe, expect, it, vi } from 'vitest'
import { createMockSession, delay, http, HttpResponse, passthrough } from '../src/http'

describe('HTTP handler matching', () => {
  it('matches relative paths across origins and decodes parameters without using query strings', async () => {
    const session = createMockSession(http.get('/users/:id', ({ params, cookies }) => HttpResponse.json({ params, cookies })))
    for (const origin of ['https://first.test', 'http://second.test:4200']) {
      const response = await session.handle(new Request(`${origin}/users/a%20b?ignored=1`, {
        headers: { cookie: 'token=a%3Db; duplicate=first; duplicate=second' },
      }))
      expect(await response?.json()).toEqual({ params: { id: 'a b' }, cookies: { token: 'a=b', duplicate: 'first' } })
    }
    await session.dispose()
  })

  it('matches absolute origins, wildcard paths, and repeated global regular expressions', async () => {
    const session = createMockSession(
      http.get('https://api.test/assets/*', ({ params }) => HttpResponse.json(params)),
      http.get(/https:\/\/regex\.test\/users\/(?<id>\d+)/g, ({ params }) => HttpResponse.json(params)),
    )
    expect(await session.handle(new Request('https://other.test/assets/one'))).toBeUndefined()
    expect(await (await session.handle(new Request('https://api.test/assets/a/b')))?.json()).toEqual({ '0': 'a/b', '*': 'a/b' })
    for (let index = 0; index < 2; index++) {
      expect(await (await session.handle(new Request('https://regex.test/users/42')))?.json()).toEqual({ 0: '42', id: '42' })
    }
    await session.dispose()
  })

  it.each([
    ['/users/:id?', '/users', {}],
    ['/users/:id?', '/users/a%20b', { id: 'a b' }],
    ['/users/:id?/posts/:post?', '/users/posts', {}],
    ['/users/:id?/posts/:post?', '/users/42/posts/7', { id: '42', post: '7' }],
    ['/assets/:path*', '/assets', {}],
    ['/assets/:path*', '/assets/a/b', { path: 'a/b' }],
    ['/assets/:path+', '/assets/a/b', { path: 'a/b' }],
    ['/:id/:id', '/one/two', { id: ['one', 'two'] }],
    ['/search/:id?ignored=true#fragment', '/search/42?actual=1', { id: '42' }],
    ['/files/:id?.json', '/files/42.json', { id: '42' }],
  ])('matches the URL pattern %s against %s', async (pattern, pathname, expected) => {
    const session = createMockSession(http.get(pattern, ({ params }) => HttpResponse.json(params)))
    try {
      expect(await (await session.handle(new Request(`https://example.test${pathname}`)))?.json()).toEqual(expected)
    }
    finally {
      await session.dispose()
    }
  })

  it('requires non-empty plus parameters and supports host wildcards and cross-origin masks', async () => {
    const session = createMockSession(
      http.get('/assets/:path+', () => HttpResponse.text('non-empty')),
      http.get('https://*.example.test/files/*', ({ params }) => HttpResponse.json(params)),
      http.get('*/health', () => HttpResponse.text('healthy')),
    )
    try {
      expect(await session.handle(new Request('https://example.test/assets'))).toBeUndefined()
      expect(await (await session.handle(new Request('https://cdn.example.test/files/a/b')))?.json()).toEqual({ '0': 'cdn', '1': 'a/b', '*': 'a/b' })
      expect(await (await session.handle(new Request('https://other.test/health')))?.text()).toBe('healthy')
    }
    finally {
      await session.dispose()
    }
  })

  it('binds browser relative masks to the current origin and resolves path-relative masks against the page', async () => {
    const session = createMockSession(
      http.get('/users/:id?', ({ params }) => HttpResponse.json(params)),
      http.get('relative/:id?', ({ params }) => HttpResponse.json(params)),
      http.get('*/shared', () => HttpResponse.text('cross-origin')),
    )
    vi.stubGlobal('location', new URL('https://page.test/app/index.html'))
    try {
      expect(await (await session.handle(new Request('https://page.test/users')))?.json()).toEqual({})
      expect(await session.handle(new Request('https://other.test/users'))).toBeUndefined()
      expect(await (await session.handle(new Request('https://page.test/app/relative/42')))?.json()).toEqual({ id: '42' })
      expect(await (await session.handle(new Request('https://other.test/shared')))?.text()).toBe('cross-origin')
      vi.stubGlobal('location', new URL('https://next.test/'))
      expect(await session.handle(new Request('https://page.test/users'))).toBeUndefined()
      expect(await (await session.handle(new Request('https://next.test/users')))?.json()).toEqual({})
    }
    finally {
      vi.unstubAllGlobals()
      await session.dispose()
    }
  })

  it('matches regular expressions against clean URLs while predicates keep query and hash data', async () => {
    const session = createMockSession(
      http.get(/\/users\/(?<id>\d+)$/, ({ params }) => HttpResponse.json(params)),
      http.get(({ request }) => new URL(request.url).searchParams.get('match') === 'yes', ({ request }) => HttpResponse.text(request.url)),
    )
    try {
      expect(await (await session.handle(new Request('https://example.test/users/42?q=1#fragment')))?.json()).toEqual({ 0: '42', id: '42' })
      expect(await (await session.handle(new Request('https://example.test/predicate?match=yes#fragment')))?.text()).toBe('https://example.test/predicate?match=yes#fragment')
    }
    finally {
      await session.dispose()
    }
  })

  it('requires an explicit HEAD handler just like MSW HTTP handlers', async () => {
    const session = createMockSession(http.get('/resource', () => HttpResponse.text('GET only')))
    try {
      expect(await session.handle(new Request('https://example.test/resource', { method: 'HEAD' }))).toBeUndefined()
    }
    finally {
      await session.dispose()
    }
  })

  it('keeps an unmatched body available even when a custom predicate reads its clone', async () => {
    const session = createMockSession(http.post(async ({ request }) => {
      expect(await request.text()).toBe('original')
      return false
    }, () => HttpResponse.text('unused')))
    const request = new Request('https://example.test/upload', { method: 'POST', body: 'original' })
    expect(await session.handle(request)).toBeUndefined()
    expect(request.bodyUsed).toBe(false)
    expect(await request.text()).toBe('original')
    await session.dispose()
  })

  it('propagates session cancellation into an asynchronous predicate without aborting the caller request', async () => {
    const entered = Promise.withResolvers<void>()
    let predicateSignal: AbortSignal | undefined
    const session = createMockSession(http.post(async ({ request }) => {
      predicateSignal = request.signal
      expect(await request.text()).toBe('original')
      entered.resolve()
      await delay('infinite', { signal: request.signal })
      return true
    }, () => HttpResponse.text('unreachable')))
    const original = new Request('https://example.test/upload', { method: 'POST', body: 'original' })
    const response = session.handle(original)
    const rejected = expect(response).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await entered.promise
      await session.dispose()
      await rejected
      expect(predicateSignal?.aborted).toBe(true)
      expect(original.signal.aborted).toBe(false)
      expect(await original.text()).toBe('original')
    }
    finally {
      await session.dispose()
    }
  })

  it('supports async predicates, original URLs, and per-resolver body copies', async () => {
    const session = createMockSession(
      http.post(async ({ request }) => ({ matches: (await request.json()).role === 'admin', params: { role: 'admin' } }), async ({ request }) => {
        expect(await request.json()).toEqual({ role: 'admin' })
      }),
      http.post('/users', async ({ request }) => HttpResponse.json(await request.json())),
    )
    const request = new Request('https://example.test/users', { method: 'POST', body: '{"role":"admin"}' })
    expect(await (await session.handle(request))?.json()).toEqual({ role: 'admin' })
    expect(request.bodyUsed).toBe(false)
    await session.dispose()
  })

  it('retains caller request metadata when attaching the session cancellation signal', async () => {
    const session = createMockSession(http.post('/metadata', ({ request }) => HttpResponse.json({
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      credentials: request.credentials,
      mode: request.mode,
      cache: request.cache,
      redirect: request.redirect,
      integrity: request.integrity,
      keepalive: request.keepalive,
    })))
    try {
      const request = new Request('https://example.test/metadata', {
        method: 'POST',
        body: 'unchanged',
        referrer: 'https://example.test/page',
        referrerPolicy: 'strict-origin-when-cross-origin',
        credentials: 'include',
        mode: 'cors',
        cache: 'no-store',
        redirect: 'manual',
        integrity: 'sha256-test',
        keepalive: true,
      })
      const expected = {
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        credentials: request.credentials,
        mode: request.mode,
        cache: request.cache,
        redirect: request.redirect,
        integrity: request.integrity,
        keepalive: request.keepalive,
      }
      expect(await (await session.handle(request))?.json()).toEqual(expected)
      expect(request.bodyUsed).toBe(false)
      expect(await request.text()).toBe('unchanged')
    }
    finally {
      await session.dispose()
    }
  })

  it('preserves sticky/global regular-expression state across sessions and concurrent matches', async () => {
    const pattern = /https:\/\/example\.test\/item\/(?<id>[^?]+)/gy
    pattern.lastIndex = 19
    const definition = http.get(pattern, ({ params }) => HttpResponse.json(params))
    const first = createMockSession(definition)
    const second = createMockSession(definition)
    try {
      const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? first : second).handle(new Request(`https://example.test/item/${index}%20value?q=1`))))
      expect(await Promise.all(responses.map(response => response?.json()))).toEqual(
        Array.from({ length: 8 }, (_, index) => ({ 0: `${index} value`, id: `${index} value` })),
      )
      expect(pattern.lastIndex).toBe(19)
    }
    finally {
      await Promise.all([first.dispose(), second.dispose()])
    }
  })

  it('stops lookup for explicit passthrough and supports all HTTP methods', async () => {
    const session = createMockSession(
      http.get('/real', () => passthrough()),
      http.all('*', ({ request }) => HttpResponse.text(request.method)),
    )
    expect(await session.handle(new Request('https://example.test/real'))).toBeUndefined()
    expect(await (await session.handle(new Request('https://example.test/real', { method: 'PUT' })))?.text()).toBe('PUT')
    const head = await session.handle(new Request('https://example.test/other', { method: 'HEAD' }))
    expect(head?.body).toBeNull()
    await session.dispose()
  })

  it.each(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const)('matches %s only', async (method) => {
    const session = createMockSession(http[method]('/resource', () => new Response(null, { status: 204 })))
    expect((await session.handle(new Request('https://example.test/resource', { method: method.toUpperCase() })))?.status).toBe(204)
    expect(await session.handle(new Request('https://example.test/resource', { method: method === 'get' ? 'POST' : 'GET' }))).toBeUndefined()
    await session.dispose()
  })
})
