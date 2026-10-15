import type { Manifest } from '../src/types'
import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '../src/runtime'

const manifest: Manifest = { version: 1, routes: [{
  method: 'GET',
  url: '/cached',
  response: { type: 'text', body: 'cached snapshot' },
}] }
const request = { method: 'GET', path: '/cached', query: {}, headers: {}, body: undefined }

describe('runtime manifest cache', () => {
  it('shares one manifest snapshot across concurrent preflight and handle calls', async () => {
    const loader = vi.fn<() => Promise<Manifest>>()
      .mockResolvedValueOnce(manifest)
      .mockResolvedValue({ version: 1, routes: [] })
    const runtime = createRuntime({ manifest: loader })

    const [matched, result, missing] = await Promise.all([
      runtime.hasRoute(request),
      runtime.handle(request),
      runtime.hasRoute({ method: 'POST', path: '/cached' }),
    ])
    expect(matched).toBe(true)
    expect(result).toMatchObject({ body: 'cached snapshot' })
    expect(missing).toBe(false)
    expect(loader).toHaveBeenCalledOnce()

    expect(await runtime.hasRoute(request)).toBe(true)
    expect(await runtime.handle(request)).toMatchObject({ body: 'cached snapshot' })
    expect(loader).toHaveBeenCalledOnce()
  })

  it.each(['rejection', 'throw'] as const)('retries a failed manifest %s without splitting concurrent callers', async (failureMode) => {
    const failure = new Error('manifest unavailable')
    const loader = vi.fn<() => Promise<Manifest>>()
      .mockImplementationOnce(() => {
        if (failureMode === 'throw') {
          throw failure
        }
        return Promise.reject(failure)
      })
      .mockResolvedValue(manifest)
    const runtime = createRuntime({ manifest: loader })

    const failures = await Promise.allSettled([
      runtime.hasRoute(request),
      runtime.handle(request),
      runtime.hasRoute({ method: 'GET', path: '/missing' }),
    ])
    expect(failures).toEqual(Array.from({ length: 3 }, () => ({ status: 'rejected', reason: failure })))
    expect(loader).toHaveBeenCalledOnce()

    const [matched, result] = await Promise.all([
      runtime.hasRoute(request),
      runtime.handle(request),
    ])
    expect(matched).toBe(true)
    expect(result).toMatchObject({ body: 'cached snapshot' })
    expect(loader).toHaveBeenCalledTimes(2)
    expect(await runtime.hasRoute(request)).toBe(true)
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
