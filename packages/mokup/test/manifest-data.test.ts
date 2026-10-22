import { Buffer } from 'node:buffer'
import { buildManifestData, toViteImportPath } from '@mokup/core'
import { parseRouteTemplate } from '@mokup/runtime'
import { HttpResponse } from '@mokup/runtime/http'
import { afterEach, describe, expect, it, vi } from 'vitest'

const root = '/root'

function createRoute(url: string, handler: unknown, file: string) {
  const parsed = parseRouteTemplate(url)
  return {
    file,
    template: parsed.template,
    method: 'GET' as const,
    tokens: parsed.tokens,
    score: parsed.score,
    handler,
  }
}

describe('manifest helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('moduleizes HttpResponse values created before a global constructor replacement', () => {
    const NativeResponse = Response
    vi.stubGlobal('Response', class ReplacementResponse extends NativeResponse {})
    const { manifest, modules } = buildManifestData({
      root,
      routes: [createRoute('/typed', HttpResponse.json({ id: 1 }), '/root/mock/typed.get.ts')],
    })
    expect(manifest.routes[0]?.response.type).toBe('module')
    expect(modules).toEqual([{ id: '/mock/typed.get.ts', kind: 'rule' }])
  })

  it('resolves Vite import paths for local and external files', () => {
    expect(toViteImportPath('/root/mock/ping.get.ts', '/root')).toBe('/mock/ping.get.ts')
    expect(toViteImportPath('mock/ping.get.ts', '/root')).toBe('/mock/ping.get.ts')
    expect(toViteImportPath('/other/mock/ping.get.ts', '/root')).toBe('/@fs//other/mock/ping.get.ts')
  })

  it('builds manifest responses and module entries', () => {
    const routes = [
      createRoute('/text', 'hello', '/root/mock/text.get.ts'),
      createRoute('/json', { ok: true }, '/root/mock/json.get.json'),
      createRoute('/binary', new Uint8Array([1, 2]), '/root/mock/bin.get.ts'),
      {
        ...createRoute('/module', () => 'ok', '/root/mock/module.get.ts'),
        ruleIndex: 2,
        middlewares: [
          {
            handle: async () => undefined,
            source: '/root/mock/index.config.ts',
            index: 0,
            position: 'pre' as const,
          },
        ],
      },
      createRoute('/response', new Response('ok'), '/root/mock/response.get.ts'),
    ]

    const { manifest, modules } = buildManifestData({ routes, root })
    const responses = manifest.routes.map(route => route.response.type)

    expect(responses).toEqual(['text', 'json', 'binary', 'module', 'module'])
    expect(manifest.routes[2]?.response.type).toBe('binary')
    if (manifest.routes[2]?.response.type === 'binary') {
      expect(manifest.routes[2].response.body).toBe(Buffer.from([1, 2]).toString('base64'))
    }

    const moduleIds = modules.map(entry => entry.id)
    expect(moduleIds).toContain('/mock/module.get.ts')
    expect(moduleIds).toContain('/mock/response.get.ts')
    expect(moduleIds).toContain('/mock/index.config.ts')

    const moduleRoute = manifest.routes.find(route => route.url === '/module')
    expect(moduleRoute?.response.type).toBe('module')
    if (moduleRoute?.response.type === 'module') {
      expect(moduleRoute.response.ruleIndex).toBe(2)
    }
  })

  it('falls back to btoa when Buffer is unavailable', () => {
    const nodeBuffer = Buffer
    vi.stubGlobal('Buffer', undefined)
    vi.stubGlobal('btoa', (input: string) => nodeBuffer.from(input, 'binary').toString('base64'))

    const { manifest } = buildManifestData({
      routes: [createRoute('/binary', new Uint8Array([1, 2]), '/root/mock/bin.get.ts')],
      root,
    })

    const response = manifest.routes[0]?.response
    expect(response?.type).toBe('binary')
    if (response?.type === 'binary') {
      expect(response.body).toBe('AQI=')
    }
  })

  it('falls back to manual base64 encoding without Buffer or btoa', () => {
    const nodeBuffer = Buffer
    vi.stubGlobal('Buffer', undefined)
    vi.stubGlobal('btoa', undefined)

    const bytes = new Uint8Array([255, 254, 253])
    const expected = nodeBuffer.from(bytes).toString('base64')

    const { manifest } = buildManifestData({
      routes: [createRoute('/binary', bytes, '/root/mock/bin.get.ts')],
      root,
    })

    const response = manifest.routes[0]?.response
    expect(response?.type).toBe('binary')
    if (response?.type === 'binary') {
      expect(response.body).toBe(expected)
    }
  })

  it('pads base64 output for short buffers', () => {
    const nodeBuffer = Buffer
    vi.stubGlobal('Buffer', undefined)
    vi.stubGlobal('btoa', undefined)

    const bytes = new Uint8Array([255])
    const expected = nodeBuffer.from(bytes).toString('base64')

    const { manifest } = buildManifestData({
      routes: [createRoute('/binary', bytes, '/root/mock/bin.get.ts')],
      root,
    })

    const response = manifest.routes[0]?.response
    expect(response?.type).toBe('binary')
    if (response?.type === 'binary') {
      expect(response.body).toBe(expected)
    }
  })

  it('handles array buffers and optional manifest fields', () => {
    const buffer = new Uint8Array([1, 2]).buffer
    const routes = [
      {
        file: '/root/mock/array.get.ts',
        template: '/array',
        method: 'GET',
        tokens: undefined,
        score: undefined,
        handler: buffer,
        status: 204,
        headers: { 'x-test': '1' },
        delay: 5,
      },
    ] as unknown as Parameters<typeof buildManifestData>[0]['routes']

    const { manifest } = buildManifestData({ routes, root })
    const response = manifest.routes[0]?.response
    expect(response?.type).toBe('binary')
    if (response?.type === 'binary') {
      expect(response.body).toBe(Buffer.from([1, 2]).toString('base64'))
    }
    expect(manifest.routes[0]?.status).toBe(204)
    expect(manifest.routes[0]?.headers).toEqual({ 'x-test': '1' })
    expect(manifest.routes[0]?.delay).toBe(5)
    expect('tokens' in (manifest.routes[0] ?? {})).toBe(false)
    expect('score' in (manifest.routes[0] ?? {})).toBe(false)
  })
})
