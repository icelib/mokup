import { describe, expect, it } from 'vitest'
import { createMockResolver } from '../src/core'

describe('protocol-relative resolver URLs', () => {
  it.each([
    '//api.example.com/users?name=hello#result',
    '//api.example.com:80/users',
    '//api.example.com:443/users',
    '//[::1]:8080/users',
  ])('preserves the authority and protocol choice of %s', (url) => {
    expect(createMockResolver().resolve({ url }).url).toBe(url)
  })

  it.each(['///', '////'])('preserves standard URL resolution with the %s prefix', (prefix) => {
    const url = `${prefix}api.example.com:80/users?name=hello#result`
    const resolved = createMockResolver().resolve({ url }).url
    const base = 'https://page.example.com/current'

    expect(resolved).toBe(url)
    expect(new URL(resolved, base).href).toBe(new URL(url, base).href)
    expect(new URL(resolved, base).host).toBe('api.example.com:80')

    const resolver = createMockResolver({
      mockBase: 'https://mock.example.com',
      allowHosts: ['api.example.com:80'],
    })
    expect(resolver.resolve({ url, mock: true }).url)
      .toBe('https://mock.example.com/users?name=hello#result')
    const blocked = `${prefix}other.example.com/users`
    expect(resolver.resolve({ url: blocked, mock: true }).url).toBe(blocked)
  })

  it('checks the host before rewriting or injecting a query marker', () => {
    const resolver = createMockResolver({
      mockBase: 'https://mock.example.com',
      allowHosts: ['api.example.com'],
      markers: { query: true },
    })
    const url = '//other.example.com/users?name=hello#result'
    const result = resolver.resolve({ url, mock: true })

    expect(result.url).toBe(url)
    expect(result.meta?.warning).toBe('host-not-allowed')
  })

  it.each(['//api.example.com\\users', '//\\api.example.com\\users'])('preserves the URL meaning and host checks of %s', (url) => {
    const resolved = createMockResolver().resolve({ url }).url
    expect(new URL(resolved, 'https://app.example.com').href)
      .toBe(new URL(url, 'https://app.example.com').href)
    const denied = createMockResolver({
      realBase: 'https://mock.example.com',
      allowHosts: ['other.example.com'],
    }).resolve({ url })
    expect(denied.url).toBe(url)
    expect(denied.meta?.warning).toBe('host-not-allowed')
  })

  it.each(['80', '443', '8080'])('retains explicit port %s when checking an allowed host', (port) => {
    const resolver = createMockResolver({
      mockBase: 'https://mock.example.com',
      allowHosts: [`api.example.com:${port}`],
      pathMap: [{ from: '/api/*', to: '/*' }],
    })

    expect(resolver.resolve({ url: `//api.example.com:${port}/api/users`, mock: true }).url)
      .toBe('https://mock.example.com/users')
  })

  it('keeps the authority when applying a path base and path map', () => {
    const resolver = createMockResolver({
      realBase: '/v2',
      pathMap: [{ from: '/api/*', to: '/*' }],
    })

    expect(resolver.resolve({ url: '//api.example.com:80/api/users?name=hello#result' }).url)
      .toBe('//api.example.com:80/v2/users?name=hello#result')
  })

  it('preserves existing relative-path and absolute-origin behavior', () => {
    const resolver = createMockResolver()

    expect(resolver.resolve({ url: 'api/users?name=hello#result' }).url).toBe('api/users?name=hello#result')
    expect(resolver.resolve({ url: '/api/users?name=hello#result' }).url).toBe('/api/users?name=hello#result')
    expect(resolver.resolve({ url: 'https://api.example.com/api/users?name=hello#result' }).url)
      .toBe('https://api.example.com/api/users?name=hello#result')
  })
})
