import { setImmediate } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { injectPlaygroundHmr } from '../src/playground/inject'

async function setup() {
  const ready = Promise.withResolvers<unknown>()
  const waitUntilReady = vi.fn(ready.promise.then.bind(ready.promise))
  const listeners = new Map<string, () => void>()
  const disposers: (() => void)[] = []
  const update = vi.fn().mockResolvedValue(undefined)
  const registration = Object.assign(new EventTarget(), {
    update,
    installing: null as (EventTarget & { state: string }) | null,
    waiting: null as (EventTarget & { state: string }) | null,
    active: Object.assign(new EventTarget(), { state: 'activated' }) as (EventTarget & { state: string }) | null,
  })
  const getRegistrations = vi.fn().mockResolvedValue([])
  const reloadRoutes = vi.fn()
  const warn = vi.fn()
  const hot = {
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    off: (event: string) => listeners.delete(event),
    dispose: (callback: () => void) => disposers.push(callback),
  }
  const html = injectPlaygroundHmr('', '/')
  const source = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'))
    .replace('import("/@vite/client")', 'loadClient()')
  runInNewContext(source, {
    loadClient: async () => ({ createHotContext: () => hot }),
    navigator: { serviceWorker: { ready: { then: waitUntilReady }, getRegistrations } },
    window: { __MOKUP_PLAYGROUND__: { reloadRoutes } },
    console: { warn },
  })
  await setImmediate()
  return {
    update,
    reloadRoutes,
    waitUntilReady,
    registration,
    getRegistrations,
    warn,
    emit: (event: string) => listeners.get(event)?.(),
    close: () => disposers.forEach(dispose => dispose()),
    makeAvailable() {
      getRegistrations.mockResolvedValue([registration])
    },
    activate() {
      getRegistrations.mockResolvedValue([registration])
      ready.resolve(registration)
    },
  }
}

describe('playground service worker HMR', () => {
  it('checks for changes once the worker is ready after loading the HMR client', async () => {
    const worker = await setup()
    expect(worker.update).not.toHaveBeenCalled()
    worker.activate()
    await setImmediate()
    expect(worker.update).toHaveBeenCalled()
  })

  it('retains route updates that arrive before a worker registration is available', async () => {
    const worker = await setup()
    worker.emit('mokup:routes-changed')
    await setImmediate()
    expect(worker.reloadRoutes).toHaveBeenCalledOnce()
    worker.activate()
    await setImmediate()
    expect(worker.update).toHaveBeenCalled()
  })

  it('updates a registration outside the playground scope while ready remains pending', async () => {
    const worker = await setup()
    worker.makeAvailable()
    worker.emit('mokup:routes-changed')
    await setImmediate()
    expect(worker.update).toHaveBeenCalledOnce()
  })

  it('waits for readiness only once when no worker is registered', async () => {
    const worker = await setup()
    worker.emit('mokup:routes-changed')
    await setImmediate()
    worker.emit('mokup:routes-changed')
    await setImmediate()
    expect(worker.waitUntilReady).toHaveBeenCalledOnce()
    expect(worker.update).not.toHaveBeenCalled()
  })

  it('coalesces route changes while an update is running', async () => {
    const worker = await setup()
    const updating = Promise.withResolvers<void>()
    worker.update.mockReturnValueOnce(updating.promise)
    worker.activate()
    await setImmediate()
    worker.emit('mokup:routes-changed')
    worker.emit('mokup:routes-changed')
    await setImmediate()
    expect(worker.update).toHaveBeenCalledOnce()
    updating.resolve()
    await setImmediate()
    expect(worker.update).toHaveBeenCalledTimes(2)
  })

  it('checks for missed updates after the HMR connection returns', async () => {
    const worker = await setup()
    worker.activate()
    await setImmediate()
    worker.update.mockClear()
    worker.emit('vite:ws:connect')
    await setImmediate()
    expect(worker.update).toHaveBeenCalledOnce()
  })

  it('cancels pending worker checks when the HMR context is disposed', async () => {
    const worker = await setup()
    worker.emit('mokup:routes-changed')
    worker.close()
    worker.activate()
    await setImmediate()
    worker.emit('mokup:routes-changed')
    await setImmediate()
    expect(worker.update).not.toHaveBeenCalled()
    expect(worker.reloadRoutes).toHaveBeenCalledOnce()
  })

  it('waits for a registration to finish installing without relying on the page scope', async () => {
    const worker = await setup()
    worker.registration.active = null
    worker.makeAvailable()
    worker.emit('mokup:routes-changed')
    await setImmediate()
    expect(worker.update).not.toHaveBeenCalled()
    const installing = Object.assign(new EventTarget(), { state: 'installing' })
    worker.registration.installing = installing
    worker.registration.dispatchEvent(new Event('updatefound'))
    await setImmediate()
    expect(worker.update).not.toHaveBeenCalled()
    installing.state = 'installed'
    worker.registration.installing = null
    worker.registration.waiting = installing
    installing.dispatchEvent(new Event('statechange'))
    await setImmediate()
    expect(worker.update).toHaveBeenCalledOnce()
  })

  it('updates installed workers while another registration is still installing', async () => {
    const worker = await setup()
    const unavailable = Object.assign(new EventTarget(), {
      installing: null,
      waiting: null,
      active: null,
      update: vi.fn(),
    })
    worker.getRegistrations.mockResolvedValue([unavailable, worker.registration])
    worker.emit('mokup:routes-changed')
    await setImmediate()
    expect(worker.update).toHaveBeenCalledOnce()
    expect(unavailable.update).not.toHaveBeenCalled()
  })

  it('removes installation listeners on disposal', async () => {
    const worker = await setup()
    worker.registration.active = null
    const installing = Object.assign(new EventTarget(), { state: 'installing' })
    worker.registration.installing = installing
    const removeRegistrationListener = vi.spyOn(worker.registration, 'removeEventListener')
    const removeWorkerListener = vi.spyOn(installing, 'removeEventListener')
    worker.makeAvailable()
    worker.emit('mokup:routes-changed')
    await setImmediate()
    worker.close()
    expect(removeRegistrationListener).toHaveBeenCalledWith('updatefound', expect.any(Function))
    expect(removeWorkerListener).toHaveBeenCalledWith('statechange', expect.any(Function))
    installing.state = 'activated'
    worker.registration.active = installing
    installing.dispatchEvent(new Event('statechange'))
    await setImmediate()
    expect(worker.update).not.toHaveBeenCalled()
  })

  it('waits for every registration update after one rejects before processing new changes', async () => {
    const worker = await setup()
    const error = new Error('update failed')
    const failedUpdate = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined)
    const otherRegistration = { ...worker.registration, update: failedUpdate }
    const updating = Promise.withResolvers<void>()
    worker.update.mockReturnValueOnce(updating.promise)
    worker.getRegistrations.mockResolvedValue([otherRegistration, worker.registration])
    worker.emit('mokup:routes-changed')
    await setImmediate()
    worker.emit('mokup:routes-changed')
    await setImmediate()
    expect(worker.update).toHaveBeenCalledOnce()
    expect(failedUpdate).toHaveBeenCalledOnce()
    updating.resolve()
    await setImmediate()
    expect(worker.update).toHaveBeenCalledTimes(2)
    expect(failedUpdate).toHaveBeenCalledTimes(2)
    expect(worker.warn).toHaveBeenCalledExactlyOnceWith('Failed to update mokup service worker:', error)
  })
})
