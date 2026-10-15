import type { ViteDevServer } from 'vite'
import type { RouteTable } from '../src/shared/types'
import type { PluginState } from '../src/vite/plugin/state'
import { parseRouteTemplate } from '@mokup/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouteRefresher } from '../src/vite/plugin/refresh'
import { buildRouteSignature } from '../src/vite/plugin/routes'

const mocks = vi.hoisted(() => ({
  scanRoutes: vi.fn<typeof import('@mokup/core').scanRoutes>(),
  appFailure: undefined as Error | undefined,
  signatureFailure: undefined as Error | undefined,
}))

vi.mock('@mokup/core', async () => {
  const actual = await vi.importActual<typeof import('@mokup/core')>('@mokup/core')
  return {
    ...actual,
    scanRoutes: mocks.scanRoutes,
    createHonoApp: (...args: Parameters<typeof actual.createHonoApp>) => {
      if (mocks.appFailure) {
        throw mocks.appFailure
      }
      return actual.createHonoApp(...args)
    },
  }
})

vi.mock('../src/vite/plugin/routes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/vite/plugin/routes')>()
  return {
    ...actual,
    buildRouteSignature: (...args: Parameters<typeof actual.buildRouteSignature>) => {
      if (mocks.signatureFailure) {
        throw mocks.signatureFailure
      }
      return actual.buildRouteSignature(...args)
    },
  }
})

function route(url: string, revision: number): RouteTable[number] {
  const parsed = parseRouteTemplate(url)
  return {
    file: `/root/mock${url}.get.json`,
    template: parsed.template,
    method: 'GET',
    tokens: parsed.tokens,
    score: parsed.score,
    handler: { revision },
  }
}

function createHarness(revision = 1) {
  const input = { revision, diagnostic: false }
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
  mocks.scanRoutes.mockImplementation(async (params) => {
    if (input.revision === 0) {
      return []
    }
    const sw = params.dirs[0] === '/root/sw'
    const dir = sw ? '/root/sw' : '/root/server'
    params.onSkip?.({ file: `${dir}/disabled-${input.revision}.get.json`, reason: 'disabled' })
    params.onIgnore?.({ file: `${dir}/notes-${input.revision}.txt`, reason: 'unsupported' })
    params.onConfig?.({ file: `${dir}/enabled-${input.revision}/index.config.ts`, enabled: true })
    params.onConfig?.({ file: `${dir}/disabled-${input.revision}/index.config.ts`, enabled: false })
    if (input.diagnostic && !sw) {
      params.logger.warn('Skip mock without handler: /root/server/broken.get.ts')
    }
    const routes = [route(sw ? '/sw-version' : '/version', input.revision)]
    if (input.revision > 1) {
      routes.push(route(sw ? '/sw-added' : '/added', input.revision))
    }
    return routes
  })
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const moduleNode = { id: '\0virtual:mokup-bundle' }
  const server = {
    ws: { send: vi.fn() },
    moduleGraph: { getModuleById: vi.fn(() => moduleNode), invalidateModule: vi.fn() },
  }
  const refresher = createRouteRefresher({
    state,
    optionList: [{ dir: '/root/server' }, { dir: '/root/sw', mode: 'sw', sw: { fallback: false } }],
    root: () => '/root',
    logger,
    enableViteMiddleware: true,
    errorOn: ['missing-handler'],
    virtualModuleIds: [moduleNode.id],
    reloadOnFirstSwRoute: true,
  })
  return { state, input, logger, server, refresh: () => refresher(server as unknown as ViteDevServer) }
}

function expectRetainedSnapshot(state: PluginState, previous: PluginState) {
  for (const key of [
    'routes',
    'serverRoutes',
    'swRoutes',
    'disabledRoutes',
    'ignoredRoutes',
    'configFiles',
    'disabledConfigFiles',
    'app',
    'lastSignature',
    'swModuleVersion',
  ] as const) {
    expect(state[key], `${key} must retain the last published snapshot`).toBe(previous[key])
  }
}

async function expectResponses(state: PluginState, revision: number) {
  if (!state.app) {
    throw new Error('Expected the published mock app to remain available')
  }
  const response = await state.app.request('/version')
  expect(response.status).toBe(200)
  await expect(response.json()).resolves.toEqual({ revision })
  expect((await state.app.request('/added')).status).toBe(revision > 1 ? 200 : 404)
}

function currentSignature(state: PluginState) {
  return buildRouteSignature(state.routes, state.disabledRoutes, state.ignoredRoutes, state.configFiles, state.disabledConfigFiles)
}

describe('atomic Vite route refresh', () => {
  beforeEach(() => {
    mocks.scanRoutes.mockReset()
    mocks.appFailure = undefined
    mocks.signatureFailure = undefined
  })

  it('retains the published routes and app after a diagnostic rejection, then recovers and clears diagnostics', async () => {
    const harness = createHarness()
    await harness.refresh()
    await expectResponses(harness.state, 1)
    const previous = { ...harness.state }
    harness.input.revision = 2
    harness.input.diagnostic = true

    await expect(harness.refresh()).rejects.toThrow('routes skipped without handler')
    expectRetainedSnapshot(harness.state, previous)
    expect(harness.state.lastDiagnosticsSignature).toContain('routes skipped without handler')
    await expectResponses(harness.state, 1)
    expect(harness.server.ws.send).not.toHaveBeenCalled()
    expect(harness.server.moduleGraph.invalidateModule).not.toHaveBeenCalled()

    harness.input.diagnostic = false
    await harness.refresh()
    await expectResponses(harness.state, 2)
    expect(harness.state.routes.map(entry => entry.template)).toContain('/added')
    expect(harness.state.swRoutes.map(entry => entry.template)).toContain('/sw-added')
    expect(harness.state.lastDiagnosticsSignature).toBeNull()
    expect(harness.logger.info).toHaveBeenCalledExactlyOnceWith('Mokup diagnostics cleared.')
    expect(harness.state.swModuleVersion).toBe((previous.swModuleVersion ?? 0) + 1)
  })

  it.each(['appFailure', 'signatureFailure'] as const)('does not publish a partial snapshot when %s occurs', async (failureKey) => {
    const harness = createHarness()
    await harness.refresh()
    const previous = { ...harness.state }
    const failure = new Error(`${failureKey} failed`)
    harness.input.revision = 2
    mocks[failureKey] = failure

    await expect(harness.refresh()).rejects.toBe(failure)
    expectRetainedSnapshot(harness.state, previous)
    await expectResponses(harness.state, 1)
    expect(harness.server.ws.send).not.toHaveBeenCalled()
    expect(harness.server.moduleGraph.invalidateModule).not.toHaveBeenCalled()

    mocks[failureKey] = undefined
    await harness.refresh()
    await expectResponses(harness.state, 2)
  })

  it('publishes the full snapshot before notifying route-change observers', async () => {
    const harness = createHarness()
    await harness.refresh()
    const previous = { ...harness.state }
    harness.input.revision = 2
    const observed: Array<{ state: PluginState, signature: string }> = []
    harness.server.ws.send.mockImplementation(() => {
      observed.push({ state: { ...harness.state }, signature: currentSignature(harness.state) })
    })

    await harness.refresh()
    expect(observed).toHaveLength(1)
    for (const observation of observed) {
      expect(observation.state.lastSignature).toBe(observation.signature)
      expect(observation.state.lastSignature).not.toBe(previous.lastSignature)
      expect(observation.state.app).toBe(harness.state.app)
      expect(observation.state.routes).toBe(harness.state.routes)
      expect(observation.state.swModuleVersion).toBe((previous.swModuleVersion ?? 0) + 1)
      await expectResponses(observation.state, 2)
    }
  })

  it('retains a successfully published snapshot when notification fails', async () => {
    const harness = createHarness()
    await harness.refresh()
    const previousVersion = harness.state.swModuleVersion ?? 0
    harness.input.revision = 2
    const failure = new Error('WebSocket notification failed')
    harness.server.ws.send.mockImplementationOnce(() => {
      throw failure
    })

    await expect(harness.refresh()).rejects.toBe(failure)
    await expectResponses(harness.state, 2)
    expect(harness.state.lastSignature).toBe(currentSignature(harness.state))
    expect(harness.state.swModuleVersion).toBe(previousVersion + 1)

    harness.server.ws.send.mockClear()
    await harness.refresh()
    expect(harness.server.ws.send).not.toHaveBeenCalled()
    expect(harness.state.swModuleVersion).toBe(previousVersion + 1)
    await expectResponses(harness.state, 2)
  })

  it('still bootstraps the first SW route after its initial candidate was rejected', async () => {
    const harness = createHarness(0)
    await harness.refresh()
    const empty = { ...harness.state }
    harness.input.revision = 1
    harness.input.diagnostic = true

    await expect(harness.refresh()).rejects.toThrow('routes skipped without handler')
    expectRetainedSnapshot(harness.state, empty)
    expect(harness.server.ws.send).not.toHaveBeenCalled()

    harness.input.diagnostic = false
    await harness.refresh()
    expect(harness.server.ws.send.mock.calls).toEqual([
      [{ type: 'custom', event: 'mokup:routes-changed', data: { ts: expect.any(Number) } }],
      [{ type: 'full-reload', path: '*' }],
    ])
    expect(harness.state.swModuleVersion).toBe(1)
    await expectResponses(harness.state, 1)
  })
})
