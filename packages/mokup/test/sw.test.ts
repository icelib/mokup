import type { Manifest } from '@mokup/runtime'
import type { ResolvedRoute } from '../src/shared/types'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { buildSwScript, resolveSwConfig, resolveSwUnregisterConfig } from '@mokup/core'
import { parseRouteTemplate } from '@mokup/runtime'
import { describe, expect, it, vi } from 'vitest'

function extractManifest(code: string): Manifest {
  const marker = 'const manifest = '
  const start = code.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const rest = code.slice(start + marker.length)
  const end = rest.indexOf('\n\n')
  expect(end).toBeGreaterThan(0)
  const json = rest.slice(0, end).trim()
  return JSON.parse(json) as Manifest
}

function createLogger(warnings: string[]) {
  return {
    info: () => undefined,
    warn: (...args: unknown[]) => warnings.push(args.map(String).join(' ')),
    error: () => undefined,
  }
}

describe('mokup SW', () => {
  it('registers the fetch listener before asynchronous app construction finishes', async () => {
    const appReady = Promise.withResolvers<{ fetch: (request: unknown, env: unknown, executionCtx: unknown) => Promise<Response> }>()
    const listeners = new Map<string, (event: { request: Request, respondWith: (response: unknown) => void }) => void>()
    const respondWith = vi.fn()
    const code = buildSwScript({ routes: [], root: '/tmp/mokup-sw' })
      .replace(
        'import { createLogger } from "@mokup/shared/logger"',
        'const createLogger = () => ({ error() {} })',
      )
      .replace(
        'import { createRuntimeApp, handle } from "mokup/runtime"',
        'const createRuntimeApp = mockCreateRuntimeApp; const handle = mockHandle',
      )

    runInNewContext(code, {
      mockCreateRuntimeApp: () => appReady.promise,
      mockHandle: (app: { fetch: (request: unknown, env: unknown, executionCtx: unknown) => Promise<Response> }) =>
        (event: { request: Request, respondWith: (response: unknown) => void }) => {
          event.respondWith(app.fetch(event.request, {}, event))
        },
      Promise,
      Request,
      Response,
      self: {
        addEventListener(type: string, listener: (event: { request: Request, respondWith: (response: unknown) => void }) => void) {
          listeners.set(type, listener)
        },
        skipWaiting() {},
        clients: { claim() {} },
      },
    })

    const fetchListener = listeners.get('fetch')
    expect(fetchListener).toBeDefined()
    fetchListener?.({ request: new Request('https://mokup.test/api/health'), respondWith })
    expect(respondWith).toHaveBeenCalledOnce()

    const response = new Response('mocked')
    appReady.resolve({ fetch: async () => response })
    await expect(respondWith.mock.calls[0]?.[0]).resolves.toBe(response)
  })

  it('builds module-based SW routes with middleware refs', () => {
    const root = path.join('/tmp', 'mokup-sw')
    const file = path.join(root, 'mock', 'users.get.ts')
    const configFile = path.join(root, 'mock', 'index.config.ts')
    const parsed = parseRouteTemplate('/api/users')
    const route: ResolvedRoute = {
      file,
      template: parsed.template,
      method: 'GET',
      tokens: parsed.tokens,
      score: parsed.score,
      handler: () => ({ ok: true }),
      middlewares: [
        {
          handle: async () => undefined,
          source: configFile,
          index: 0,
          position: 'normal',
        },
      ],
      status: 201,
      headers: { 'x-mokup': '1' },
      delay: 120,
      ruleIndex: 3,
    }

    const code = buildSwScript({ routes: [route], root })
    const manifest = extractManifest(code)
    const manifestRoute = manifest.routes[0]

    expect(code).toContain('import { createRuntimeApp, handle } from \"mokup/runtime\"')
    expect(manifestRoute?.response.type).toBe('module')
    if (!manifestRoute || manifestRoute.response.type !== 'module') {
      throw new Error('Expected module response')
    }
    expect(manifestRoute.response.module).toBe('/mock/users.get.ts')
    expect(manifestRoute.response.ruleIndex).toBe(3)
    expect(manifestRoute?.status).toBe(201)
    expect(manifestRoute?.headers).toEqual({ 'x-mokup': '1' })
    expect(manifestRoute?.delay).toBe(120)
    expect(manifestRoute?.middleware?.[0]?.module).toBe('/mock/index.config.ts')
    expect(manifestRoute?.middleware?.[0]?.ruleIndex).toBe(0)
    expect(code).toContain(
      '"/mock/users.get.ts": { default: toRuntimeRules(resolveModuleExport(module0)) },',
    )
    expect(code).toContain(
      '"/mock/index.config.ts": module1,',
    )
  })

  it('normalizes module rules to handler in SW runtime', () => {
    const root = path.join('/tmp', 'mokup-sw')
    const file = path.join(root, 'mock', 'users.get.ts')
    const parsed = parseRouteTemplate('/api/users')
    const route: ResolvedRoute = {
      file,
      template: parsed.template,
      method: 'GET',
      tokens: parsed.tokens,
      score: parsed.score,
      handler: () => ({ ok: true }),
    }

    const code = buildSwScript({ routes: [route], root })

    expect(code).toContain('return { handler: value }')
    expect(code).toContain('handler: handlerRule.handler')
    expect(code).toContain('handler: responseRule.response')
  })

  it('inlines non-function handlers into the manifest', () => {
    const root = path.join('/tmp', 'mokup-sw')
    const file = path.join(root, 'mock', 'health.get.json')
    const parsed = parseRouteTemplate('/health')
    const route: ResolvedRoute = {
      file,
      template: parsed.template,
      method: 'GET',
      tokens: parsed.tokens,
      score: parsed.score,
      handler: { ok: true },
    }

    const code = buildSwScript({ routes: [route], root })
    const manifest = extractManifest(code)
    const manifestRoute = manifest.routes[0]

    expect(manifestRoute?.response.type).toBe('json')
    if (!manifestRoute || manifestRoute.response.type !== 'json') {
      throw new Error('Expected json response')
    }
    expect(manifestRoute.response.body).toEqual({ ok: true })
    expect(code).not.toContain('const moduleMap =')
  })

  it('allows custom module path resolution', () => {
    const root = path.join('/tmp', 'mokup-sw')
    const file = path.join(root, 'mock', 'users.get.ts')
    const parsed = parseRouteTemplate('/users')
    const route: ResolvedRoute = {
      file,
      template: parsed.template,
      method: 'GET',
      tokens: parsed.tokens,
      score: parsed.score,
      handler: () => ({ ok: true }),
    }

    const code = buildSwScript({
      routes: [route],
      root,
      resolveModulePath: () => '/abs/mock/users.get.ts',
    })

    expect(code).toContain('import * as module0 from "/abs/mock/users.get.ts"')
  })

  it('appends module version query for SW hot updates', () => {
    const root = path.join('/tmp', 'mokup-sw')
    const file = path.join(root, 'mock', 'users.get.ts')
    const parsed = parseRouteTemplate('/users')
    const route: ResolvedRoute = {
      file,
      template: parsed.template,
      method: 'GET',
      tokens: parsed.tokens,
      score: parsed.score,
      handler: () => ({ ok: true }),
    }

    const code = buildSwScript({
      routes: [route],
      root,
      moduleVersion: 7,
      resolveModulePath: () => '/abs/mock/users.get.ts',
    })

    expect(code).toContain('import * as module0 from "/abs/mock/users.get.ts?mokupv=7"')
  })

  it('uses defaults when SW config is missing overrides', () => {
    const warnings: string[] = []
    const logger = createLogger(warnings)
    const result = resolveSwConfig([{ mode: 'sw' }], logger)

    expect(result).toEqual({
      path: '/mokup-sw.js',
      scope: '/',
      register: true,
      unregister: false,
      basePaths: [],
    })
    expect(warnings).toHaveLength(0)
  })

  it('keeps the first SW config and warns on conflicts', () => {
    const warnings: string[] = []
    const logger = createLogger(warnings)
    const result = resolveSwConfig([
      {
        mode: 'sw',
        sw: {
          path: 'mock-sw.js',
          scope: 'api',
          register: false,
        },
      },
      {
        mode: 'sw',
        sw: {
          path: '/other.js',
          scope: '/other',
          register: true,
        },
      },
    ], logger)

    expect(result).toEqual({
      path: '/mock-sw.js',
      scope: '/api',
      register: false,
      unregister: false,
      basePaths: [],
    })
    expect(warnings.some(message => message.includes('SW path'))).toBe(true)
    expect(warnings.some(message => message.includes('SW scope'))).toBe(true)
    expect(warnings.some(message => message.includes('SW register'))).toBe(true)
  })

  it('resolves unregister config from non-SW entries', () => {
    const warnings: string[] = []
    const logger = createLogger(warnings)
    const result = resolveSwUnregisterConfig([
      {
        mode: 'server',
        sw: {
          path: '/mock-sw.js',
          scope: '/api',
          unregister: true,
        },
      },
    ], logger)

    expect(result).toEqual({
      path: '/mock-sw.js',
      scope: '/api',
      register: true,
      unregister: true,
      basePaths: [],
    })
    expect(warnings).toHaveLength(0)
  })

  it('returns defaults for unregister config when no entries match', () => {
    const warnings: string[] = []
    const logger = createLogger(warnings)
    const result = resolveSwUnregisterConfig([], logger)

    expect(result).toEqual({
      path: '/mokup-sw.js',
      scope: '/',
      register: true,
      unregister: false,
      basePaths: [],
    })
    expect(warnings).toHaveLength(0)
  })

  it('normalizes base paths and prefixes', () => {
    const warnings: string[] = []
    const logger = createLogger(warnings)
    const result = resolveSwConfig([
      { mode: 'sw', prefix: 'api' },
      { mode: 'sw', sw: { basePath: ['/docs/', ''] } },
    ], logger)

    expect(result?.basePaths).toEqual(expect.arrayContaining(['/api', '/docs', '/']))
  })

  it('warns on unregister conflicts and normalizes basePath strings', () => {
    const warnings: string[] = []
    const logger = createLogger(warnings)
    const result = resolveSwConfig([
      { mode: 'sw', sw: { unregister: true, basePath: 'docs/' } },
      { mode: 'sw', sw: { unregister: false } },
    ], logger)

    expect(result?.unregister).toBe(true)
    expect(result?.basePaths).toEqual(['/docs'])
    expect(warnings.some(message => message.includes('SW unregister'))).toBe(true)
  })

  it('keeps repeated SW overrides without warnings', () => {
    const warnings: string[] = []
    const logger = createLogger(warnings)
    const result = resolveSwUnregisterConfig([
      {
        mode: 'sw',
        sw: {
          path: 'sw.js',
          scope: 'api',
          register: false,
          unregister: true,
        },
      },
      {
        mode: 'sw',
        sw: {
          path: 'sw.js',
          scope: 'api',
          register: false,
          unregister: true,
        },
      },
    ], logger)

    expect(result).toEqual({
      path: '/sw.js',
      scope: '/api',
      register: false,
      unregister: true,
      basePaths: [],
    })
    expect(warnings).toHaveLength(0)
  })
})
