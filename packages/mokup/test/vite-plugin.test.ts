import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { http, HttpResponse } from '@mokup/runtime/http'
import { describe, expect, it, vi } from 'vitest'
import { createMokupPlugin } from '../src/vite/plugin'

describe('vite plugin basics', () => {
  it('rejects native session options when Vite only emits a Worker bundle', () => {
    const handler = http.get('/native', () => HttpResponse.text('native'))
    const expected = /currently require runtime: "node"/
    expect(() => createMokupPlugin({ runtime: 'worker', handlers: [handler] })).toThrow(expected)
    expect(() => createMokupPlugin({ runtime: 'worker', onUnhandled: 'error' })).toThrow(expected)
    expect(() => createMokupPlugin({ runtime: 'worker', onUnhandled: 'bypass' })).toThrow(expected)
    expect(() => createMokupPlugin({ runtime: 'worker', handlers: [] })).not.toThrow()
  })

  it('resolves and loads virtual modules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-vite-'))
    const mockDir = join(root, 'mock')
    await mkdir(mockDir, { recursive: true })
    await writeFile(join(mockDir, 'ping.get.json'), JSON.stringify({ ok: true }), 'utf8')

    const plugin = createMokupPlugin({
      entries: { dir: mockDir, prefix: '/api', mode: 'sw' },
      playground: false,
    })

    const bundleId = plugin.resolveId?.('virtual:mokup-bundle')
    const swId = plugin.resolveId?.('virtual:mokup-sw')
    const lifecycleId = plugin.resolveId?.('virtual:mokup-sw-lifecycle')

    expect(bundleId).toBe('\0virtual:mokup-bundle')
    expect(swId).toBe('\0virtual:mokup-sw')
    expect(lifecycleId).toBe('\0virtual:mokup-sw-lifecycle')

    const ctx = {
      addWatchFile: vi.fn(),
      resolve: vi.fn(async () => null),
    }

    const bundleCode = await plugin.load?.call(ctx, bundleId as string)
    expect(typeof bundleCode).toBe('string')
    expect(bundleCode).toContain('manifest')

    const swCode = await plugin.load?.call(ctx, swId as string)
    expect(typeof swCode).toBe('string')
    expect((swCode as string).length).toBeGreaterThan(0)

    const lifecycleCode = await plugin.load?.call(ctx, lifecycleId as string)
    expect(typeof lifecycleCode).toBe('string')
    expect((lifecycleCode as string).length).toBeGreaterThan(0)
  })

  it('injects sw lifecycle script in transformIndexHtml', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-vite-'))
    const mockDir = join(root, 'mock')
    await mkdir(mockDir, { recursive: true })
    await writeFile(join(mockDir, 'ping.get.json'), JSON.stringify({ ok: true }), 'utf8')

    const plugin = createMokupPlugin({
      entries: { dir: mockDir, prefix: '/api', mode: 'sw' },
      playground: false,
    })

    plugin.configResolved?.({
      root,
      base: '/',
      command: 'serve',
      build: { outDir: 'dist', assetsDir: 'assets', ssr: false },
    } as any)

    const result = await plugin.transformIndexHtml?.('<html></html>')
    expect(result).not.toBeNull()
  })

  it('emits sw assets during buildStart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mokup-vite-'))
    const mockDir = join(root, 'mock')
    await mkdir(mockDir, { recursive: true })
    await writeFile(join(mockDir, 'ping.get.json'), JSON.stringify({ ok: true }), 'utf8')

    const plugin = createMokupPlugin({
      entries: { dir: mockDir, prefix: '/api', mode: 'sw' },
      playground: false,
    })

    plugin.configResolved?.({
      root,
      base: '/',
      command: 'build',
      build: { outDir: 'dist', assetsDir: 'assets', ssr: false },
    } as any)

    const emitFile = vi.fn()
    await plugin.buildStart?.call({ emitFile }, undefined as any)

    expect(emitFile).toHaveBeenCalled()
  })
})
