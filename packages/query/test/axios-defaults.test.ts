import type { AxiosAdapter } from 'axios'
import axios from 'axios'
import { describe, expect, it } from 'vitest'
import { createAxiosExecutor } from '../src/index'

const uriAdapter: AxiosAdapter = async config => ({
  config,
  data: axios.getUri(config),
  headers: {},
  status: 200,
  statusText: 'OK',
})

describe('Axios executor instance defaults', () => {
  it.each([
    ['https://api.example.test/api/v1', '/users', 'https://api.example.test/api/v1/users'],
    ['/api', '/api/users', '/api/api/users'],
    ['api/v1', 'users', 'api/v1/users'],
  ])('resolves %s and %s like the supplied instance', async (baseURL, url, expected) => {
    const api = axios.create({ baseURL, adapter: uriAdapter })
    const executor = createAxiosExecutor({ axios: api })

    expect(api.getUri({ url })).toBe(expected)
    expect(await executor({ url })).toBe(expected)
  })

  it.each([
    ['https://other.example.test/users', true, 'https://other.example.test/users'],
    ['https://other.example.test/users', false, 'https://api.example.test/api/https://other.example.test/users'],
    ['//other.example.test/users', true, '//other.example.test/users'],
    ['//other.example.test/users', false, 'https://api.example.test/api/other.example.test/users'],
  ] as const)('resolves %s with instance allowAbsoluteUrls=%s', async (url, allowAbsoluteUrls, expected) => {
    const api = axios.create({
      baseURL: 'https://api.example.test/api',
      allowAbsoluteUrls,
      adapter: uriAdapter,
    })
    const executor = createAxiosExecutor({ axios: api })

    expect(api.getUri({ url })).toBe(expected)
    expect(await executor({ url })).toBe(expected)
  })

  it('reads replaced and cleared defaults on each execution', async () => {
    const api = axios.create({
      baseURL: 'https://old.example.test/v1',
      allowAbsoluteUrls: false,
      adapter: uriAdapter,
    })
    const executor = createAxiosExecutor({ axios: api })

    expect(await executor({ url: '/users' })).toBe('https://old.example.test/v1/users')
    api.defaults.baseURL = 'https://new.example.test/v2'
    expect(await executor({ url: '/users' })).toBe('https://new.example.test/v2/users')
    expect(await executor({ url: 'https://other.example.test/users' }))
      .toBe('https://new.example.test/v2/https://other.example.test/users')

    delete api.defaults.allowAbsoluteUrls
    expect(await executor({ url: 'https://other.example.test/users' }))
      .toBe('https://other.example.test/users')
    delete api.defaults.baseURL
    expect(await executor({ url: '/users' })).toBe('/users')
  })

  it('rewrites the combined URL once without reapplying the instance base', async () => {
    const controller = new AbortController()
    let receivedSignal: unknown
    const api = axios.create({
      baseURL: 'https://api.example.test/v1',
      allowAbsoluteUrls: false,
      adapter: async (config) => {
        receivedSignal = config.signal
        return uriAdapter(config)
      },
    })
    const executor = createAxiosExecutor({
      axios: api,
      resolverOptions: {
        mockBase: 'https://mock.example.test/mock',
        allowHosts: ['api.example.test'],
      },
    })

    expect(await executor({
      url: '/users',
      params: { page: 2 },
      mock: true,
    }, { signal: controller.signal })).toBe('https://mock.example.test/mock/v1/users?page=2')
    expect(receivedSignal).toBe(controller.signal)
  })
})
