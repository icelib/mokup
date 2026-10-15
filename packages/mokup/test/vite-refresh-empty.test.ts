import type { ViteDevServer } from 'vite'
import type { RouteTable } from '../src/shared/types'
import type { PluginState } from '../src/vite/plugin/state'
import { parseRouteTemplate } from '@mokup/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouteRefresher } from '../src/vite/plugin/refresh'

const mocks = vi.hoisted(() => ({ scanRoutes: vi.fn() }))

vi.mock('@mokup/core', async () => {
  const actual = await vi.importActual<typeof import('@mokup/core')>('@mokup/core')
  return { ...actual, scanRoutes: mocks.scanRoutes }
})

function createHarness(options: { reloadOnChange?: boolean, reloadOnFirstSwRoute?: boolean, mode?: 'server' | 'sw' } = {}) {
  const { mode = 'sw', ...refresherOptions } = options
  const state: PluginState = {
    routes: [],
    serverRoutes: [],
    swRoutes: [],
    disabledRoutes: [],
    ignoredRoutes: [],
    configFiles: [],
    disabledConfigFiles: [],
    app: null,
    lastSignature: null,
    lastDiagnosticsSignature: null,
    swModuleVersion: 0,
  }
  const importer = { id: '/worker.ts', importers: new Set() }
  const bundle = { id: '\0virtual:mokup-bundle', importers: new Set([importer]) }
  const server = {
    ws: { send: vi.fn() },
    moduleGraph: {
      getModuleById: vi.fn(() => bundle),
      invalidateModule: vi.fn(),
    },
  }
  const refresher = createRouteRefresher({
    state,
    optionList: [{ dir: '/root/mock', mode }],
    root: () => '/root',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    enableViteMiddleware: false,
    virtualModuleIds: [bundle.id],
    ...refresherOptions,
  })
  const refresh = (routes: RouteTable, refreshOptions?: Parameters<typeof refresher>[1]) => {
    mocks.scanRoutes.mockResolvedValueOnce(routes)
    return refresher(server as unknown as ViteDevServer, refreshOptions)
  }
  const clearNotifications = () => {
    server.ws.send.mockClear()
    server.moduleGraph.getModuleById.mockClear()
    server.moduleGraph.invalidateModule.mockClear()
  }
  const expectInvalidated = () => {
    expect(server.moduleGraph.getModuleById).toHaveBeenCalledExactlyOnceWith(bundle.id)
    expect(server.moduleGraph.invalidateModule.mock.calls).toEqual([[bundle], [importer]])
  }
  return { state, server, refresh, clearNotifications, expectInvalidated }
}

const parsed = parseRouteTemplate('/ping')
const routes: RouteTable = [{
  file: '/root/mock/ping.get.json',
  template: parsed.template,
  method: 'GET',
  tokens: parsed.tokens,
  score: parsed.score,
  handler: { ok: true },
}]
const routeEvent = { type: 'custom', event: 'mokup:routes-changed', data: { ts: expect.any(Number) } }

describe('Vite refresh across empty route tables', () => {
  beforeEach(() => {
    mocks.scanRoutes.mockReset()
  })

  it('notifies and invalidates first additions, removal of the last route, and later additions', async () => {
    const harness = createHarness()
    await harness.refresh([])
    expect(harness.state.lastSignature).toBe('')
    expect(harness.server.ws.send).not.toHaveBeenCalled()
    expect(harness.server.moduleGraph.invalidateModule).not.toHaveBeenCalled()

    for (const nextRoutes of [routes, [], routes]) {
      harness.clearNotifications()
      await harness.refresh(nextRoutes)
      expect(harness.state.swRoutes).toHaveLength(nextRoutes.length)
      expect(harness.server.ws.send).toHaveBeenCalledExactlyOnceWith(routeEvent)
      harness.expectInvalidated()
    }
  })

  it('keeps unchanged empty scans quiet but honors a forced refresh after initialization', async () => {
    const harness = createHarness()
    await harness.refresh([], { force: true })
    await harness.refresh([])
    expect(harness.server.ws.send).not.toHaveBeenCalled()
    expect(harness.server.moduleGraph.invalidateModule).not.toHaveBeenCalled()

    await harness.refresh([], { force: true })
    expect(harness.server.ws.send).toHaveBeenCalledExactlyOnceWith(routeEvent)
    harness.expectInvalidated()
  })

  it('keeps silent additions and removals quiet without losing later empty-to-populated notifications', async () => {
    const harness = createHarness({ reloadOnChange: true, reloadOnFirstSwRoute: true })
    await harness.refresh([])
    await harness.refresh(routes, { silent: true })
    expect(harness.state.swRoutes).toHaveLength(1)
    await harness.refresh([], { silent: true, force: true })
    expect(harness.state.lastSignature).toBe('')
    expect(harness.server.ws.send).not.toHaveBeenCalled()
    expect(harness.server.moduleGraph.invalidateModule).not.toHaveBeenCalled()

    await harness.refresh(routes)
    expect(harness.server.ws.send.mock.calls).toEqual([[routeEvent], [{ type: 'full-reload', path: '*' }]])
    harness.expectInvalidated()
  })

  it('retains worker full reloads when adding the first route or removing the last route', async () => {
    const harness = createHarness({ reloadOnChange: true, reloadOnFirstSwRoute: true })
    await harness.refresh([])
    expect(harness.server.ws.send).not.toHaveBeenCalled()

    for (const nextRoutes of [routes, [], routes]) {
      harness.clearNotifications()
      await harness.refresh(nextRoutes)
      expect(harness.server.ws.send.mock.calls).toEqual([[routeEvent], [{ type: 'full-reload', path: '*' }]])
      harness.expectInvalidated()
    }
  })

  it.each([true, false])('only bootstraps newly available SW routes when enabled (%s)', async (reloadOnFirstSwRoute) => {
    const harness = createHarness({ reloadOnFirstSwRoute })
    await harness.refresh([])
    expect(harness.server.ws.send).not.toHaveBeenCalled()

    for (let index = 0; index < 2; index += 1) {
      harness.clearNotifications()
      await harness.refresh(routes)
      expect(harness.server.ws.send.mock.calls).toEqual(reloadOnFirstSwRoute
        ? [[routeEvent], [{ type: 'full-reload', path: '*' }]]
        : [[routeEvent]])
      harness.expectInvalidated()

      harness.clearNotifications()
      await harness.refresh(routes.map(route => ({ ...route, status: 201 })))
      expect(harness.server.ws.send).toHaveBeenCalledExactlyOnceWith(routeEvent)
      harness.expectInvalidated()

      harness.clearNotifications()
      await harness.refresh([])
      expect(harness.server.ws.send).toHaveBeenCalledExactlyOnceWith(routeEvent)
      harness.expectInvalidated()
    }
  })

  it('does not bootstrap when only server routes become available', async () => {
    const harness = createHarness({ reloadOnFirstSwRoute: true, mode: 'server' })
    await harness.refresh([])
    await harness.refresh(routes)
    expect(harness.state.serverRoutes).toHaveLength(1)
    expect(harness.state.swRoutes).toEqual([])
    expect(harness.server.ws.send).toHaveBeenCalledExactlyOnceWith(routeEvent)
    harness.expectInvalidated()
  })

  it('does not reload an initial populated scan before the server is initialized', async () => {
    const harness = createHarness({ reloadOnFirstSwRoute: true, reloadOnChange: true })
    await harness.refresh(routes)
    expect(harness.state.swRoutes).toHaveLength(1)
    expect(harness.server.ws.send).not.toHaveBeenCalled()
    expect(harness.server.moduleGraph.invalidateModule).not.toHaveBeenCalled()
  })
})
