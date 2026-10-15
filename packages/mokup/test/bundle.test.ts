import type { Manifest } from '@mokup/runtime'
import type { ResolvedRoute } from '../src/shared/types'
import path from 'node:path'
import { buildBundleModule } from '@mokup/core'
import { parseRouteTemplate } from '@mokup/runtime'
import { describe, expect, it } from 'vitest'

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

describe('mokup bundle module', () => {
  it('builds module-based bundle routes with middleware refs', () => {
    const root = path.join('/tmp', 'mokup-bundle')
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

    const code = buildBundleModule({ routes: [route], root })
    const manifest = extractManifest(code)
    const manifestRoute = manifest.routes[0]

    expect(code).toContain('import * as module0 from "/mock/users.get.ts"')
    expect(code).toContain('import * as module1 from "/mock/index.config.ts"')
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
      '"/mock/users.get.ts": module0,',
    )
    expect(code).toContain(
      '"/mock/index.config.ts": module1,',
    )
  })

  it('inlines non-function handlers into the manifest', () => {
    const root = path.join('/tmp', 'mokup-bundle')
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

    const code = buildBundleModule({ routes: [route], root })
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
    const root = path.join('/tmp', 'mokup-bundle')
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

    const code = buildBundleModule({
      routes: [route],
      root,
      resolveModulePath: () => '/abs/mock/users.get.ts',
    })

    expect(code).toContain('import * as module0 from "/abs/mock/users.get.ts"')
  })
})
