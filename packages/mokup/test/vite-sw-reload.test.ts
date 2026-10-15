import type { ViteDevServer } from 'vite'
import type { MokupPluginOptions, RouteTable, VitePluginOptions } from '../src/shared/types'
import { parseRouteTemplate } from '@mokup/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMokupPlugin } from '../src/vite/plugin'

const mocks = vi.hoisted(() => ({
  scanRoutes: vi.fn<typeof import('@mokup/core').scanRoutes>(),
  configureDevServer: vi.fn<typeof import('../src/vite/plugin/server-hooks').configureDevServer>(),
}))

vi.mock('@mokup/core', async () => ({
  ...await vi.importActual<typeof import('@mokup/core')>('@mokup/core'),
  scanRoutes: mocks.scanRoutes,
}))

vi.mock('../src/vite/plugin/server-hooks', () => ({
  configureDevServer: mocks.configureDevServer,
  configurePreviewServer: vi.fn(),
}))

const routeEvent = { type: 'custom', event: 'mokup:routes-changed', data: { ts: expect.any(Number) } }
const reloadEvent = { type: 'full-reload', path: '*' }
const browserEntry: VitePluginOptions = { mode: 'sw', sw: { fallback: false } }

async function createHarness(options: MokupPluginOptions, initialRevision: number | null = 1) {
  let revision = initialRevision
  mocks.scanRoutes.mockImplementation(async ({ dirs, prefix }) => {
    if (revision === null) {
      return []
    }
    const parsed = parseRouteTemplate(`${prefix}/value`)
    return [{
      file: `${dirs[0]}/value.get.json`,
      template: parsed.template,
      method: 'GET',
      tokens: parsed.tokens,
      score: parsed.score,
      handler: { revision },
    }] satisfies RouteTable
  })
  const configuredEntries = Array.isArray(options.entries) ? options.entries : [options.entries ?? {}]
  const plugin = createMokupPlugin({
    ...options,
    playground: false,
    entries: configuredEntries.map((entry, index) => ({
      ...entry,
      dir: `/mock/entry-${index}`,
      prefix: `/api-${index}`,
      log: false,
    })),
  })
  const importer = { id: '/worker.ts', importers: new Set() }
  const bundle = { id: '\0virtual:mokup-bundle', importers: new Set([importer]) }
  const server = {
    ws: { send: vi.fn() },
    watcher: {},
    moduleGraph: {
      getModuleById: vi.fn(() => bundle),
      invalidateModule: vi.fn(),
    },
    close: vi.fn(async () => {}),
  }
  if (typeof plugin.configureServer !== 'function') {
    throw new TypeError('Expected a configureServer hook')
  }
  await plugin.configureServer(server as unknown as ViteDevServer)
  const configured = mocks.configureDevServer.mock.calls.at(-1)?.[0]
  if (!configured) {
    throw new Error('Missing configured server refresh callback')
  }
  expect(server.ws.send).not.toHaveBeenCalled()
  return {
    server,
    async refresh(nextRevision: number | null) {
      revision = nextRevision
      server.ws.send.mockClear()
      server.moduleGraph.invalidateModule.mockClear()
      // Watchers force a refresh because JSON body edits do not change route signatures.
      await configured.refreshRoutes(configured.server, { force: true })
      expect(server.moduleGraph.invalidateModule.mock.calls).toEqual([[bundle], [importer]])
    },
    close: () => server.close(),
  }
}

describe('Vite service worker reload ownership', () => {
  beforeEach(() => {
    mocks.scanRoutes.mockReset()
    mocks.configureDevServer.mockReset()
    mocks.configureDevServer.mockImplementation(async (params) => {
      await params.refreshRoutes(params.server)
      return null
    })
  })

  it.each(['node', 'worker'] as const)('%s leaves automatic browser-only edits and deletions to the SW updater', async (runtime) => {
    const harness = await createHarness({ runtime, entries: [browserEntry, browserEntry] }, null)
    try {
      for (const revision of [1, 3]) {
        await harness.refresh(revision)
        // Every empty-to-populated transition must also bootstrap pages opened while empty.
        expect(harness.server.ws.send.mock.calls).toEqual([[routeEvent], [reloadEvent]])

        await harness.refresh(revision + 1)
        expect(harness.server.ws.send.mock.calls).toEqual([[routeEvent]])

        await harness.refresh(null)
        expect(harness.server.ws.send.mock.calls).toEqual([[routeEvent]])
      }
    }
    finally {
      await harness.close()
    }
  })

  const reloadCases: Array<{ name: string, entries: VitePluginOptions | VitePluginOptions[] }> = [
    { name: 'default server entries', entries: {} },
    { name: 'explicit server entries', entries: { mode: 'server' } },
    { name: 'SW entries with default fallback', entries: { mode: 'sw' } },
    { name: 'SW entries with explicit fallback', entries: { mode: 'sw', sw: { fallback: true } } },
    { name: 'mixed SW and server entries', entries: [browserEntry, { mode: 'server' }] },
    { name: 'mixed SW entries with a fallback consumer', entries: [browserEntry, { mode: 'sw' }] },
    { name: 'manual SW registration', entries: { mode: 'sw', sw: { fallback: false, register: false } } },
    { name: 'SW unregistration', entries: { mode: 'sw', sw: { fallback: false, unregister: true } } },
  ]

  it.each(reloadCases)('preserves Worker reloads for $name', async ({ entries }) => {
    const harness = await createHarness({ runtime: 'worker', entries })
    try {
      for (const revision of [2, null, 3]) {
        await harness.refresh(revision)
        expect(harness.server.ws.send.mock.calls).toEqual([[routeEvent], [reloadEvent]])
      }
    }
    finally {
      await harness.close()
    }
  })

  it.each(reloadCases)('keeps Node edits and deletions free of Worker reloads for $name', async ({ entries }) => {
    const harness = await createHarness({ runtime: 'node', entries })
    try {
      for (const revision of [2, null]) {
        await harness.refresh(revision)
        expect(harness.server.ws.send.mock.calls).toEqual([[routeEvent]])
      }
    }
    finally {
      await harness.close()
    }
  })
})
