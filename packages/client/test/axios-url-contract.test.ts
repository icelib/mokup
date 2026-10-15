import type { AxiosAdapter, AxiosRequestConfig } from 'axios'
import axios, { AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { applyMokupToAxios, createAxiosRequestInterceptor } from '../src/adapters/axios'

const uriAdapter: AxiosAdapter = async config => ({
  config,
  data: axios.getUri(config),
  headers: {},
  status: 200,
  statusText: 'OK',
})

const urlCases = [
  ...['https://api.example.test/api/v1', 'https://api.example.test/api/v1/'].flatMap(baseURL =>
    ['/users', 'users'].map(url => ({
      name: `${baseURL} + ${url}`,
      config: { baseURL, url },
      expected: 'https://api.example.test/api/v1/users',
    })),
  ),
  {
    name: 'relative base with a repeated path prefix',
    config: { baseURL: '/api', url: '/api/users' },
    expected: '/api/api/users',
  },
  {
    name: 'relative base without a leading slash',
    config: { baseURL: 'api/v1', url: 'users' },
    expected: 'api/v1/users',
  },
  ...[undefined, true, false].map(allowAbsoluteUrls => ({
    name: `absolute URL with allowAbsoluteUrls=${allowAbsoluteUrls}`,
    config: {
      baseURL: 'https://api.example.test/api',
      url: 'https://other.example.test/users',
      ...(allowAbsoluteUrls === undefined ? {} : { allowAbsoluteUrls }),
    },
    expected: allowAbsoluteUrls === false
      ? 'https://api.example.test/api/https://other.example.test/users'
      : 'https://other.example.test/users',
  })),
  ...[undefined, true, false].map(allowAbsoluteUrls => ({
    name: `protocol-relative URL with allowAbsoluteUrls=${allowAbsoluteUrls}`,
    config: {
      baseURL: 'http://api.example.test/api',
      url: '//other.example.test/users',
      ...(allowAbsoluteUrls === undefined ? {} : { allowAbsoluteUrls }),
    },
    expected: allowAbsoluteUrls === false
      ? 'http://api.example.test/api/other.example.test/users'
      : '//other.example.test/users',
  })),
  {
    name: 'protocol-relative URL without a base',
    config: { url: '//other.example.test/users' },
    expected: '//other.example.test/users',
  },
  ...['///other.example.test/users', '////other.example.test/users'].map(url => ({
    name: `protocol-relative URL with extra slashes: ${url}`,
    config: { baseURL: 'https://api.example.test/api', url },
    expected: url,
  })),
] satisfies Array<{ name: string, config: AxiosRequestConfig, expected: string }>

describe('Axios URL contract', () => {
  it.each([
    { baseURL: 'https://api.example.test/v1', url: 'http:other.example.test/users' },
    { baseURL: 'https://api.example.test/v1', url: ' \tht\ntp:other.example.test/users' },
    { baseURL: 'http:api.example.test/v1', url: '/users' },
  ])('preserves native rejection of malformed HTTP URLs: %j', async (config) => {
    const native = axios.create({ adapter: uriAdapter })
    const adapted = axios.create({ adapter: uriAdapter })
    applyMokupToAxios(adapted, {
      resolverOptions: { realBase: 'https://real.example.test' },
    })

    await expect(native.request(config)).rejects.toMatchObject({ code: 'ERR_INVALID_URL' })
    await expect(adapted.request(config)).rejects.toMatchObject({ code: 'ERR_INVALID_URL' })
  })

  it('ignores an unused malformed base when an absolute URL is allowed', async () => {
    const config = { baseURL: 'http:api.example.test/v1', url: 'https://other.example.test/users' }
    const adapted = axios.create({ adapter: uriAdapter })
    applyMokupToAxios(adapted)

    expect((await adapted.request(config)).data).toBe(axios.getUri(config))
  })

  it('preserves omitted and disabled Axios headers when applying markers', async () => {
    const adapter: AxiosAdapter = async config => ({
      config,
      data: config.headers.toJSON(),
      headers: {},
      status: 200,
      statusText: 'OK',
    })
    const native = axios.create({ adapter })
    const adapted = axios.create({ adapter })
    applyMokupToAxios(adapted, { resolverOptions: { markers: { header: true } } })
    const config = {
      url: 'https://api.example.test/users',
      headers: { 'Content-Type': false, 'X-Omitted': null, 'X-Count': 2 },
    }

    const expected = (await native.request(config)).data
    expect((await adapted.request(config)).data).toEqual({
      ...expected,
      'x-mokup': '0',
      'x-mokup-mode': 'real',
    })
  })

  it.each(urlCases)('$name matches native Axios', async ({ config, expected }) => {
    const api = axios.create({ adapter: uriAdapter })
    applyMokupToAxios(api)

    expect(axios.getUri(config)).toBe(expected)
    expect((await api.request(config)).data).toBe(expected)
  })

  it.each([undefined, '/api'])('preserves a blocked protocol-relative host with base %s', async (baseURL) => {
    const api = axios.create({ adapter: uriAdapter, ...(baseURL ? { baseURL } : {}) })
    applyMokupToAxios(api, {
      resolverOptions: {
        mockBase: 'https://mock.example.test',
        allowHosts: ['api.example.test'],
        env: { useMock: true },
        markers: { query: true },
      },
    })

    expect((await api.request({ url: '//other.example.test/users' })).data)
      .toBe('//other.example.test/users')
  })

  it.each([
    ['https://other.example.test/users', 'https://mock.example.test/api/https://other.example.test/users'],
    ['//other.example.test/users', 'https://mock.example.test/api/other.example.test/users'],
  ])('checks the combined host before rewriting %s', async (url, expected) => {
    const api = axios.create({
      adapter: uriAdapter,
      baseURL: 'https://api.example.test/api',
      allowAbsoluteUrls: false,
    })
    applyMokupToAxios(api, {
      resolverOptions: {
        mockBase: 'https://mock.example.test',
        allowHosts: ['api.example.test'],
        env: { useMock: true },
      },
    })

    expect((await api.request({ url })).data).toBe(expected)
  })

  it('uses replaced and cleared instance defaults', async () => {
    const api = axios.create({ adapter: uriAdapter, baseURL: 'https://old.example.test/v1' })
    applyMokupToAxios(api)

    expect((await api.request({ url: '/users' })).data).toBe('https://old.example.test/v1/users')
    api.defaults.baseURL = 'https://new.example.test/v2'
    expect((await api.request({ url: '/users' })).data).toBe('https://new.example.test/v2/users')
    delete api.defaults.baseURL
    expect((await api.request({ url: '/users' })).data).toBe('/users')
  })

  it('honors per-request overrides of instance URL defaults', async () => {
    const api = axios.create({
      adapter: uriAdapter,
      baseURL: 'https://api.example.test/v1',
      allowAbsoluteUrls: false,
    })
    applyMokupToAxios(api)

    expect((await api.request({ url: '/users', baseURL: '' })).data).toBe('/users')
    expect((await api.request({
      url: 'https://other.example.test/users',
      allowAbsoluteUrls: true,
    })).data).toBe('https://other.example.test/users')
  })

  it('preserves Axios parameter serialization and the request signal', async () => {
    const controller = new AbortController()
    let receivedSignal: unknown
    const api = axios.create({
      baseURL: 'https://api.example.test/v1',
      adapter: async (config) => {
        receivedSignal = config.signal
        return uriAdapter(config)
      },
    })
    applyMokupToAxios(api)
    const config = {
      url: '/users?existing=yes',
      params: { tag: ['a', 'b'] },
      paramsSerializer: { serialize: () => 'tag=a|b' },
      signal: controller.signal,
    }

    const response = await api.request(config)
    expect(response.data).toBe('https://api.example.test/v1/users?existing=yes&tag=a|b')
    expect(receivedSignal).toBe(controller.signal)
  })

  it('preserves AxiosHeaders for following interceptors and the adapter', async () => {
    const interceptor = createAxiosRequestInterceptor({
      resolverOptions: { markers: { header: true } },
    })
    const api = axios.create({
      adapter: async (config) => {
        expect(config.headers).toBeInstanceOf(AxiosHeaders)
        expect(config.headers.get('x-mokup')).toBe('0')
        expect(config.headers.get('x-next')).toBe('preserved')
        config.headers.set('x-adapter', 'ok')
        expect(config.headers.get('x-adapter')).toBe('ok')
        return uriAdapter(config)
      },
    })
    api.interceptors.request.use(async (config) => {
      const headers = config.headers
      const resolved = await interceptor(config)
      expect(resolved.headers).toBe(headers)
      resolved.headers.set('x-next', resolved.headers.get('x-test'))
      return resolved
    })

    await api.request({ url: '/users', headers: { 'X-Test': 'preserved' } })
  })
})
