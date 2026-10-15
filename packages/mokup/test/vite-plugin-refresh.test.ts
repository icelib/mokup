import { parseRouteTemplate } from '@mokup/runtime'
import { describe, expect, it, vi } from 'vitest'
import { createRouteRefresher } from '../src/vite/plugin/refresh'
import { buildRouteSignature } from '../src/vite/plugin/routes'

const mocks = vi.hoisted(() => ({
  scanRoutes: vi.fn(),
}))

vi.mock('@mokup/core', async () => {
  const actual = await vi.importActual<typeof import('@mokup/core')>('@mokup/core')
  return {
    ...actual,
    scanRoutes: mocks.scanRoutes,
  }
})

describe('vite plugin route refresh', () => {
  it('refreshes routes and notifies the dev server', async () => {
    const parsed = parseRouteTemplate('/ping')
    let callIndex = 0
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    mocks.scanRoutes.mockImplementation(async (params: any) => {
      params.logger.warn(`Skip mock with unsupported fields (response): /root/mock/unsupported-${callIndex}.get.ts`)
      params.logger.warn(`Skip mock without handler: /root/mock/missing-${callIndex}.get.ts`)
      params.logger.warn(`Duplicate mock route GET /api/dup-${callIndex} from /root/mock/dup-${callIndex}.get.ts`)
      params.onSkip?.({ reason: 'disabled', file: '/root/mock/skip.get.ts' })
      params.onIgnore?.({ reason: 'invalid-route', file: '/root/mock/(group)/users.get.json' })
      params.onConfig?.({ file: '/root/mock/index.config.ts', enabled: callIndex === 0 })
      callIndex += 1
      return [
        {
          file: '/root/mock/ping.get.ts',
          template: parsed.template,
          method: 'GET',
          tokens: parsed.tokens,
          score: parsed.score,
          handler: { ok: true },
        },
      ]
    })

    const state = {
      routes: [],
      serverRoutes: [],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: null,
      lastSignature: 'old',
      swModuleVersion: 0,
    }

    const refresher = createRouteRefresher({
      state: state as never,
      optionList: [
        {
          dir: '/root/mock',
          prefix: '/api',
          mode: 'sw',
          sw: { fallback: false },
          include: [/^ping/],
          exclude: [/skip/],
          ignorePrefix: ['_'],
        },
        {
          dir: '/root/server',
          prefix: '/srv',
          mode: 'server',
        },
      ],
      root: () => '/root',
      logger,
      enableViteMiddleware: true,
    })

    const server = { ws: { send: vi.fn() } }
    await refresher(server as never)

    expect(state.routes).toHaveLength(2)
    expect(state.swRoutes).toHaveLength(1)
    expect(state.serverRoutes).toHaveLength(1)
    expect(state.disabledRoutes).toHaveLength(2)
    expect(state.ignoredRoutes).toHaveLength(2)
    expect(state.configFiles).toHaveLength(0)
    expect(state.disabledConfigFiles).toHaveLength(1)
    expect(state.app).not.toBeNull()
    expect(state.swModuleVersion).toBe(1)
    expect(server.ws.send).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Mokup diagnostics summary: 1 invalid route files ignored'),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('routes skipped for unsupported rule fields'),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('routes skipped without handler'),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('duplicate route definitions'),
    )

    const firstCall = mocks.scanRoutes.mock.calls[0]?.[0]
    expect(firstCall.include).toEqual([/^ping/])
    expect(firstCall.exclude).toEqual([/skip/])
    expect(firstCall.ignorePrefix).toEqual(['_'])
  })

  it('invalidates virtual modules when routes change', async () => {
    const parsed = parseRouteTemplate('/ping')
    mocks.scanRoutes.mockResolvedValueOnce([
      {
        file: '/root/mock/ping.get.json',
        template: parsed.template,
        method: 'GET',
        tokens: parsed.tokens,
        score: parsed.score,
        handler: { ok: true },
      },
    ])

    const state = {
      routes: [],
      serverRoutes: [],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: null,
      lastSignature: 'old',
      swModuleVersion: 0,
    }

    const moduleNode = { id: '\0virtual:mokup-bundle' }
    const server = {
      ws: { send: vi.fn() },
      moduleGraph: {
        getModuleById: vi.fn().mockImplementation((id: string) => (
          id === '\0virtual:mokup-bundle' ? moduleNode : null
        )),
        invalidateModule: vi.fn(),
      },
    }

    const refresher = createRouteRefresher({
      state: state as never,
      optionList: [{ dir: '/root/mock', prefix: '/api' }],
      root: () => '/root',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      enableViteMiddleware: false,
      virtualModuleIds: ['\0virtual:mokup-bundle', '\0virtual:missing'],
    })

    await refresher(server as never)

    expect(server.moduleGraph.getModuleById).toHaveBeenCalledWith('\0virtual:mokup-bundle')
    expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(moduleNode)
  })

  it('invalidates importer chains for virtual modules when routes change', async () => {
    const parsed = parseRouteTemplate('/ping')
    mocks.scanRoutes.mockResolvedValueOnce([
      {
        file: '/root/mock/ping.get.json',
        template: parsed.template,
        method: 'GET',
        tokens: parsed.tokens,
        score: parsed.score,
        handler: { ok: true },
      },
    ])

    const state = {
      routes: [],
      serverRoutes: [],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: null,
      lastSignature: 'old',
      swModuleVersion: 0,
    }

    const workerImporter = { id: '/worker/index.ts', importers: new Set() }
    const moduleNode = {
      id: '\0virtual:mokup-bundle',
      importers: new Set([workerImporter]),
    }
    const server = {
      ws: { send: vi.fn() },
      moduleGraph: {
        getModuleById: vi.fn().mockReturnValue(moduleNode),
        invalidateModule: vi.fn(),
      },
    }

    const refresher = createRouteRefresher({
      state: state as never,
      optionList: [{ dir: '/root/mock', prefix: '/api' }],
      root: () => '/root',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      enableViteMiddleware: false,
      virtualModuleIds: ['\0virtual:mokup-bundle'],
    })

    await refresher(server as never)

    expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(moduleNode)
    expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(workerImporter)
  })

  it('invalidates virtual modules in each Vite environment graph', async () => {
    const parsed = parseRouteTemplate('/ping')
    mocks.scanRoutes.mockResolvedValueOnce([
      {
        file: '/root/mock/ping.get.json',
        template: parsed.template,
        method: 'GET',
        tokens: parsed.tokens,
        score: parsed.score,
        handler: { ok: true },
      },
    ])

    const state = {
      routes: [],
      serverRoutes: [],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: null,
      lastSignature: 'old',
      swModuleVersion: 0,
    }

    const workerImporter = { id: '/worker/index.ts', importers: new Set() }
    const workerModule = {
      id: '\0virtual:mokup-bundle',
      importers: new Set([workerImporter]),
    }
    const legacyModule = { id: '\0virtual:mokup-bundle' }
    const workerGraph = {
      getModuleById: vi.fn().mockReturnValue(workerModule),
      invalidateModule: vi.fn(),
    }
    const server = {
      ws: { send: vi.fn() },
      moduleGraph: {
        getModuleById: vi.fn().mockReturnValue(legacyModule),
        invalidateModule: vi.fn(),
      },
      environments: {
        client: { moduleGraph: undefined },
        web_mokup_worker: { moduleGraph: workerGraph },
      },
    }

    const refresher = createRouteRefresher({
      state: state as never,
      optionList: [{ dir: '/root/mock', prefix: '/api' }],
      root: () => '/root',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      enableViteMiddleware: false,
      virtualModuleIds: ['\0virtual:mokup-bundle'],
    })

    await refresher(server as never)

    expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(legacyModule)
    expect(workerGraph.invalidateModule).toHaveBeenCalledWith(workerModule)
    expect(workerGraph.invalidateModule).toHaveBeenCalledWith(workerImporter)
  })

  it('forces virtual module invalidation when signatures are unchanged', async () => {
    const parsed = parseRouteTemplate('/about')
    const route = {
      file: '/root/mock/about.get.json',
      template: parsed.template,
      method: 'GET',
      tokens: parsed.tokens,
      score: parsed.score,
      handler: { title: 'about' },
    }
    mocks.scanRoutes.mockResolvedValueOnce([route])

    const state = {
      routes: [],
      serverRoutes: [],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: null,
      lastSignature: buildRouteSignature([route], [], [], [], []),
      swModuleVersion: 0,
    }

    const moduleNode = { id: '\0virtual:mokup-bundle' }
    const server = {
      ws: { send: vi.fn() },
      moduleGraph: {
        getModuleById: vi.fn().mockReturnValue(moduleNode),
        invalidateModule: vi.fn(),
      },
    }

    const refresher = createRouteRefresher({
      state: state as never,
      optionList: [{ dir: '/root/mock', prefix: '/api' }],
      root: () => '/root',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      enableViteMiddleware: false,
      virtualModuleIds: ['\0virtual:mokup-bundle'],
    })

    await refresher(server as never, { force: true })

    expect(server.ws.send).toHaveBeenCalled()
    expect(state.swModuleVersion).toBe(0)
    expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(moduleNode)
  })

  it('triggers a full reload when reloadOnChange is enabled', async () => {
    const parsed = parseRouteTemplate('/about')
    mocks.scanRoutes.mockResolvedValueOnce([
      {
        file: '/root/mock/about.get.json',
        template: parsed.template,
        method: 'GET',
        tokens: parsed.tokens,
        score: parsed.score,
        handler: { title: 'about' },
      },
    ])

    const state = {
      routes: [],
      serverRoutes: [],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: null,
      lastSignature: 'old',
      swModuleVersion: 0,
    }

    const server = {
      ws: { send: vi.fn() },
    }

    const refresher = createRouteRefresher({
      state: state as never,
      optionList: [{ dir: '/root/mock', prefix: '/api' }],
      root: () => '/root',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      enableViteMiddleware: false,
      reloadOnChange: true,
    })

    await refresher(server as never)

    expect(server.ws.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'full-reload' }))
  })

  it('logs when diagnostics are cleared', async () => {
    const parsed = parseRouteTemplate('/clear')
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    mocks.scanRoutes.mockImplementation(async () => [
      {
        file: '/root/mock/clear.get.json',
        template: parsed.template,
        method: 'GET',
        tokens: parsed.tokens,
        score: parsed.score,
        handler: { ok: true },
      },
    ])

    const state = {
      routes: [],
      serverRoutes: [],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: null,
      lastSignature: 'old',
      lastDiagnosticsSignature: 'previous-diagnostics',
      swModuleVersion: 0,
    }

    const refresher = createRouteRefresher({
      state: state as never,
      optionList: [{ dir: '/root/mock', prefix: '/api' }],
      root: () => '/root',
      logger,
      enableViteMiddleware: false,
    })

    await refresher({ ws: { send: vi.fn() } } as never)

    expect(logger.info).toHaveBeenCalledWith('Mokup diagnostics cleared.')
    expect(state.lastDiagnosticsSignature).toBeNull()
  })

  it('throws when selected diagnostics are promoted to errors', async () => {
    const parsed = parseRouteTemplate('/strict')
    mocks.scanRoutes.mockImplementation(async (params: any) => {
      params.logger.warn('Skip mock without handler: /root/mock/strict.get.ts')
      return [
        {
          file: '/root/mock/strict.get.json',
          template: parsed.template,
          method: 'GET',
          tokens: parsed.tokens,
          score: parsed.score,
          handler: { ok: true },
        },
      ]
    })

    const state = {
      routes: [],
      serverRoutes: [],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: null,
      lastSignature: 'old',
      lastDiagnosticsSignature: null,
      swModuleVersion: 0,
    }

    const refresher = createRouteRefresher({
      state: state as never,
      optionList: [{ dir: '/root/mock', prefix: '/api' }],
      root: () => '/root',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      enableViteMiddleware: false,
      errorOn: ['missing-handler'],
    })

    await expect(refresher({ ws: { send: vi.fn() } } as never))
      .rejects
      .toThrow(/Mokup diagnostics error: 1 routes skipped without handler/)
    expect(state.lastDiagnosticsSignature).toContain('routes skipped without handler')
  })

  it('does not throw when promoted diagnostics do not match', async () => {
    const parsed = parseRouteTemplate('/strict-safe')
    mocks.scanRoutes.mockImplementation(async (params: any) => {
      params.logger.warn('Skip mock without handler: /root/mock/strict-safe.get.ts')
      return [
        {
          file: '/root/mock/strict-safe.get.json',
          template: parsed.template,
          method: 'GET',
          tokens: parsed.tokens,
          score: parsed.score,
          handler: { ok: true },
        },
      ]
    })

    const state = {
      routes: [],
      serverRoutes: [],
      swRoutes: [],
      disabledRoutes: [],
      ignoredRoutes: [],
      configFiles: [],
      disabledConfigFiles: [],
      app: null,
      lastSignature: 'old',
      lastDiagnosticsSignature: null,
      swModuleVersion: 0,
    }

    const refresher = createRouteRefresher({
      state: state as never,
      optionList: [{ dir: '/root/mock', prefix: '/api' }],
      root: () => '/root',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      enableViteMiddleware: false,
      errorOn: ['duplicate-route'],
    })

    await expect(refresher({ ws: { send: vi.fn() } } as never)).resolves.toBeUndefined()
  })
})
