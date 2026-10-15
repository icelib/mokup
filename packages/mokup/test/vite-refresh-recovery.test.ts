import type { ViteDevServer } from 'vite'
import type { PluginState } from '../src/vite/plugin/state'
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSwScript } from '@mokup/core'
import { describe, expect, it, vi } from 'vitest'
import { createRouteRefresher } from '../src/vite/plugin/refresh'
import { createServerSession } from '../src/vite/plugin/server-session'

const committedKeys = [
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
] as const

function expectCommittedSnapshot(state: PluginState, previous: PluginState) {
  for (const key of committedKeys) {
    expect(state[key], `Committed ${key} must survive a rejected refresh`).toBe(previous[key])
  }
}

function createRefreshGate() {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  return { entered, release }
}

async function createFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'mokup-refresh-recovery-')))
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
  const send = vi.fn()
  // Only the HMR transport is replaced. Scanning, module loading, HTTP routing,
  // SW generation, and the session's refresh queue use their real implementations.
  const server = { ws: { send } } as unknown as ViteDevServer
  const refresh = createRouteRefresher({
    state,
    optionList: [{ dir: root, prefix: '/api', mode: 'sw' }],
    root: () => root,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    enableViteMiddleware: true,
    reloadOnFirstSwRoute: true,
    errorOn: ['missing-handler'],
  })
  let nextGate: ReturnType<typeof createRefreshGate> | undefined
  const session = createServerSession({
    server,
    refresh: async (currentServer, options) => {
      const gate = nextGate
      nextGate = undefined
      try {
        await refresh(currentServer, options)
      }
      finally {
        gate?.entered.resolve()
        await gate?.release.promise
      }
    },
    onError: vi.fn(),
  })
  return {
    root,
    state,
    send,
    session,
    write: (file: string, content: string) => writeFile(join(root, file), content),
    sw: () => buildSwScript({ routes: state.swRoutes, root, moduleVersion: state.swModuleVersion ?? 0 }),
    holdNextRefresh() {
      const gate = createRefreshGate()
      nextGate = gate
      return gate
    },
    async close() {
      try {
        await session.close()
      }
      finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  }
}

const routeEvent = { type: 'custom', event: 'mokup:routes-changed', data: { ts: expect.any(Number) } }

describe('Vite refresh recovery with real mock files', () => {
  it('bootstraps the first SW route only after its candidate passes diagnostics', async () => {
    const fixture = await createFixture()
    try {
      await fixture.session.refresh()
      const empty = { ...fixture.state }
      const emptyWorker = fixture.sw()
      expect(empty.lastSignature).toBe('')
      expect(fixture.send).not.toHaveBeenCalled()

      await fixture.write('ping.get.json', JSON.stringify({ revision: 1 }))
      await fixture.write('broken.get.ts', 'export default {}')
      await expect(fixture.session.refresh()).rejects.toThrow(/routes skipped without handler/)

      expectCommittedSnapshot(fixture.state, empty)
      expect(fixture.state.app).toBeNull()
      expect(fixture.sw()).toBe(emptyWorker)
      expect(fixture.send).not.toHaveBeenCalled()

      await unlink(join(fixture.root, 'broken.get.ts'))
      await fixture.session.refresh()

      expect(fixture.state.routes.map(route => route.template)).toEqual(['/api/ping'])
      expect(fixture.state.serverRoutes).toHaveLength(1)
      expect(fixture.state.swRoutes).toHaveLength(1)
      expect(fixture.state.swModuleVersion).toBe(1)
      expect(fixture.state.lastSignature).not.toBe(empty.lastSignature)
      const response = await fixture.state.app!.request('http://localhost/api/ping')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ revision: 1 })
      expect(fixture.sw()).toContain('"revision": 1')
      expect(fixture.send.mock.calls).toEqual([[routeEvent], [{ type: 'full-reload', path: '*' }]])
    }
    finally {
      await fixture.close()
    }
  })

  it('preserves the complete served snapshot while a failed scan has a recovery queued', async () => {
    const fixture = await createFixture()
    let gate: ReturnType<typeof createRefreshGate> | undefined
    try {
      await fixture.write('index.config.ts', 'export default { headers: { "x-revision": "1" } }')
      await fixture.write('ping.get.json', JSON.stringify({ revision: 1 }))
      await fixture.session.refresh()
      const previous = { ...fixture.state }
      const previousWorker = fixture.sw()
      expect(previous.configFiles).toHaveLength(1)
      expect(previous.swModuleVersion).toBe(1)
      expect(fixture.send).not.toHaveBeenCalled()

      await fixture.write('index.config.ts', 'export default { headers: { "x-revision": "2" } }')
      await fixture.write('ping.get.json', JSON.stringify({ revision: 2 }))
      await fixture.write('new.get.json', JSON.stringify({ added: true }))
      await fixture.write('broken.get.ts', 'export default {}')
      await fixture.write('disabled.get.ts', 'export default { enabled: false, handler: {} }')
      await fixture.write('notes.txt', 'Ignored candidate file')
      await mkdir(join(fixture.root, 'disabled'))
      await fixture.write('disabled/index.config.ts', 'export default { enabled: false }')
      await mkdir(join(fixture.root, 'enabled'))
      await fixture.write('enabled/index.config.ts', 'export default { headers: { "x-candidate": "yes" } }')

      // Hold the completed real scan inside the session, so recovery must queue
      // behind the rejected attempt instead of bypassing its controller.
      gate = fixture.holdNextRefresh()
      const rejected = fixture.session.refresh().catch((error: unknown) => error)
      await gate.entered.promise
      const recovered = fixture.session.refresh()

      expectCommittedSnapshot(fixture.state, previous)
      expect(fixture.sw()).toBe(previousWorker)
      const oldResponse = await fixture.state.app!.request('http://localhost/api/ping')
      expect(oldResponse.headers.get('x-revision')).toBe('1')
      expect(await oldResponse.json()).toEqual({ revision: 1 })
      expect((await fixture.state.app!.request('http://localhost/api/new')).status).toBe(404)
      expect(fixture.send).not.toHaveBeenCalled()

      await unlink(join(fixture.root, 'broken.get.ts'))
      gate.release.resolve()
      expect(await rejected).toMatchObject({ message: expect.stringContaining('routes skipped without handler') })
      await recovered

      expect(fixture.state.app).not.toBe(previous.app)
      expect(fixture.state.routes.map(route => route.template).sort()).toEqual(['/api/new', '/api/ping'])
      expect(fixture.state.serverRoutes).toHaveLength(2)
      expect(fixture.state.swRoutes).toHaveLength(2)
      expect(fixture.state.configFiles).toHaveLength(2)
      expect(fixture.state.disabledConfigFiles).toHaveLength(1)
      expect(fixture.state.disabledRoutes).toHaveLength(1)
      expect(fixture.state.ignoredRoutes).toHaveLength(1)
      expect(fixture.state.swModuleVersion).toBe(2)
      expect(fixture.state.lastSignature).not.toBe(previous.lastSignature)
      const currentResponse = await fixture.state.app!.request('http://localhost/api/ping')
      expect(currentResponse.headers.get('x-revision')).toBe('2')
      expect(await currentResponse.json()).toEqual({ revision: 2 })
      expect(await (await fixture.state.app!.request('http://localhost/api/new')).json()).toEqual({ added: true })
      expect(fixture.sw()).toContain('"revision": 2')
      expect(fixture.sw()).toContain('/api/new')
      expect(fixture.send.mock.calls).toEqual([[routeEvent]])
    }
    finally {
      gate?.release.resolve()
      await fixture.close()
    }
  })
})
