import type { RouteTable, VitePluginOptions } from '../src/shared/types'
import { parseRouteTemplate } from '@mokup/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSwConfig, resolveSwUnregisterConfig } from '../src/internal/core'
import { createWebpackBuild } from '../src/webpack/plugin/build'

const mocks = vi.hoisted(() => ({
  scanRoutes: vi.fn<typeof import('@mokup/core').scanRoutes>(),
  bundleScript: vi.fn<typeof import('../src/webpack/plugin/bundle').bundleScript>(),
  appFailure: undefined as Error | undefined,
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

vi.mock('../src/webpack/plugin/bundle', () => ({ bundleScript: mocks.bundleScript }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function route(revision: number): RouteTable[number] {
  const parsed = parseRouteTemplate('/version')
  return {
    file: '/root/mock/version.get.json',
    template: parsed.template,
    method: 'GET',
    tokens: parsed.tokens,
    score: parsed.score,
    handler: { revision },
  }
}

function harness() {
  const input = { revision: 1, diagnostic: false, root: '/root', base: '/first/', active: true }
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() }
  const optionList: VitePluginOptions[] = [{ dir: 'mock', mode: 'sw' }]
  mocks.scanRoutes.mockImplementation(async (params) => {
    if (input.diagnostic) {
      params.logger.warn('Skip mock without handler: /root/mock/broken.get.ts')
    }
    return input.revision > 0 ? [route(input.revision)] : []
  })
  const build = createWebpackBuild({
    optionList,
    root: () => input.root,
    base: () => input.base,
    swConfig: resolveSwConfig(optionList, logger),
    unregisterConfig: resolveSwUnregisterConfig(optionList, logger),
    logger,
    errorOn: ['missing-handler'],
  })
  return { input, logger, build: () => build(() => input.active) }
}

describe('Webpack candidate builds', () => {
  beforeEach(() => {
    mocks.scanRoutes.mockReset()
    mocks.bundleScript.mockReset().mockImplementation(async params => params.code)
    mocks.appFailure = undefined
  })

  it('retains the published routes and bundles after rejected diagnostics and reports recovery', async () => {
    const { input, logger, build } = harness()
    const previous = await build()
    expect(previous).not.toBeNull()
    const previousResponse = await previous?.state.app?.request('/version')
    await expect(previousResponse?.json()).resolves.toEqual({ revision: 1 })
    input.revision = 2
    input.diagnostic = true

    await expect(build()).rejects.toThrow('routes skipped without handler')
    expect(previous?.state.routes[0]?.handler).toEqual({ revision: 1 })
    expect(previous?.bundles.swBundle).toContain('revision')
    expect(previous?.state.lastDiagnosticsSignature).toBeNull()
    expect(mocks.bundleScript).toHaveBeenCalledTimes(2)

    input.diagnostic = false
    const latest = await build()
    const latestResponse = await latest?.state.app?.request('/version')
    await expect(latestResponse?.json()).resolves.toEqual({ revision: 2 })
    expect(logger.info).toHaveBeenCalledExactlyOnceWith('Mokup diagnostics cleared.')
    const retainedResponse = await previous?.state.app?.request('/version')
    await expect(retainedResponse?.json()).resolves.toEqual({ revision: 1 })
  })

  it.each(['app', 'bundle'] as const)('does not mutate a published snapshot when the next %s fails', async (stage) => {
    const { input, build } = harness()
    const previous = await build()
    const previousBundles = { ...previous?.bundles }
    input.revision = 2
    const error = new Error(`${stage} failed`)
    if (stage === 'app') {
      mocks.appFailure = error
    }
    else {
      mocks.bundleScript.mockResolvedValueOnce('candidate lifecycle').mockRejectedValueOnce(error)
    }

    await expect(build()).rejects.toBe(error)
    expect(previous?.bundles).toEqual(previousBundles)
    const response = await previous?.state.app?.request('/version')
    await expect(response?.json()).resolves.toEqual({ revision: 1 })

    mocks.appFailure = undefined
    const recovered = await build()
    expect(recovered?.state.routes[0]?.handler).toEqual({ revision: 2 })
  })

  it('captures root and base before an asynchronous scan', async () => {
    const { input, build } = harness()
    const gate = deferred()
    mocks.scanRoutes.mockImplementationOnce(async (params) => {
      expect(params.dirs).toEqual(['/root/mock'])
      await gate.promise
      return [route(1)]
    })
    const pending = build()
    input.root = '/next'
    input.base = '/next/'
    gate.resolve()
    const result = await pending

    expect(result).toMatchObject({ root: '/root', base: '/first/' })
    expect(mocks.bundleScript.mock.calls.map(([params]) => params.root)).toEqual(['/root', '/root'])
    expect(result?.bundles.swLifecycleBundle).toContain('/first/mokup-sw.js')
    expect(result?.bundles.swLifecycleBundle).not.toContain('/next/')
  })

  it('builds the first SW routes and removes bundles when the next candidate is empty', async () => {
    const { input, build } = harness()
    input.revision = 0
    const empty = await build()
    expect(empty?.bundles).toEqual({ swLifecycleBundle: null, swBundle: null })
    expect(mocks.bundleScript).not.toHaveBeenCalled()
    input.revision = 1
    const added = await build()
    expect(added?.bundles.swLifecycleBundle).toContain('registerMokupServiceWorker')
    expect(added?.bundles.swBundle).toContain('revision')
    input.revision = 0
    const removed = await build()
    expect(removed?.state.app).toBeNull()
    expect(removed?.bundles).toEqual({ swLifecycleBundle: null, swBundle: null })
    expect(added?.bundles.swBundle).toContain('revision')
  })

  it('does not start bundles or forward scan diagnostics after becoming inactive', async () => {
    const { input, logger, build } = harness()
    const gate = deferred()
    mocks.scanRoutes.mockImplementationOnce(async (params) => {
      await gate.promise
      params.logger.warn('late diagnostic')
      params.logger.info('late info')
      params.logger.error('late error')
      params.logger.log?.('late log')
      return [route(1)]
    })
    const pending = build()
    input.active = false
    gate.resolve()

    await expect(pending).resolves.toBeNull()
    expect(mocks.bundleScript).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.log).not.toHaveBeenCalled()
    await expect(build()).resolves.toBeNull()
    expect(mocks.scanRoutes).toHaveBeenCalledTimes(1)
  })

  it('discards an in-flight bundle and prevents the next bundle after becoming inactive', async () => {
    const { input, build } = harness()
    const gate = deferred()
    mocks.bundleScript.mockImplementationOnce(async () => {
      await gate.promise
      return 'late lifecycle'
    })
    const pending = build()
    await vi.waitFor(() => expect(mocks.bundleScript).toHaveBeenCalledTimes(1))
    input.active = false
    gate.resolve()

    await expect(pending).resolves.toBeNull()
    expect(mocks.bundleScript).toHaveBeenCalledTimes(1)
  })
})
