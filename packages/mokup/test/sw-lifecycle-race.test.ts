import { setImmediate } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { buildSwLifecycleScript as buildViteScript } from '../src/vite/plugin/sw'
import { buildSwLifecycleScript as buildWebpackScript } from '../src/webpack/plugin/sw'

function createRegistration(update: () => Promise<void>, available = true) {
  return Object.assign(new EventTarget(), {
    update,
    installing: null as (EventTarget & { state: string }) | null,
    waiting: null as (EventTarget & { state: string }) | null,
    active: available ? Object.assign(new EventTarget(), { state: 'activated' }) : null,
  })
}

function createHotContext() {
  const listeners = new Map<string, Set<() => void>>()
  const disposers: (() => void)[] = []
  return {
    on(event: string, listener: () => void) {
      const callbacks = listeners.get(event) ?? new Set()
      callbacks.add(listener)
      listeners.set(event, callbacks)
    },
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener)
    },
    dispose(callback: () => void) {
      disposers.push(callback)
    },
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) {
        listener()
      }
    },
    close() {
      for (const dispose of disposers) {
        dispose()
      }
    },
  }
}

describe.each([
  ['vite', buildViteScript],
  ['webpack', buildWebpackScript],
] as const)('%s service worker lifecycle', (_, buildScript) => {
  function setup(hasHot = true) {
    const pending = Promise.withResolvers<ReturnType<typeof createRegistration> | null>()
    const hot = createHotContext()
    const warn = vi.fn()
    const register = vi.fn(() => pending.promise)
    const script = buildScript({
      importPath: 'mokup/sw',
      swConfig: { path: '/sw.js', scope: '/', register: true, unregister: false, basePaths: [] },
      unregisterConfig: { path: '/sw.js', scope: '/', register: true, unregister: false, basePaths: [] },
      hasSwEntries: true,
      hasSwRoutes: true,
      resolveRequestPath: path => path,
      resolveRegisterScope: scope => scope,
    })!
    const source = script.split('\n').slice(1).join('\n').replaceAll('import.meta.hot', 'mockHot')
    runInNewContext(source, {
      mockHot: hasHot ? hot : undefined,
      registerMokupServiceWorker: register,
      console: { warn },
    })
    return { pending, hot, warn, register }
  }

  it('retains route changes while service worker registration is pending', async () => {
    const { pending, hot } = setup()
    const update = vi.fn().mockResolvedValue(undefined)
    hot.emit('mokup:routes-changed')
    pending.resolve(createRegistration(update))
    await setImmediate()
    expect(update).toHaveBeenCalled()
  })

  it('checks for missed changes on startup and after reconnecting', async () => {
    const { pending, hot } = setup()
    const update = vi.fn().mockResolvedValue(undefined)
    pending.resolve(createRegistration(update))
    await setImmediate()
    expect(update).toHaveBeenCalled()
    update.mockClear()
    hot.emit('vite:ws:connect')
    await setImmediate()
    expect(update).toHaveBeenCalledOnce()
  })

  it('does not update after the lifecycle is disposed during registration', async () => {
    const { pending, hot } = setup()
    const update = vi.fn().mockResolvedValue(undefined)
    hot.emit('mokup:routes-changed')
    hot.close()
    pending.resolve(createRegistration(update))
    await setImmediate()
    hot.emit('mokup:routes-changed')
    await setImmediate()
    expect(update).not.toHaveBeenCalled()
  })

  it('handles failed updates without losing later route changes', async () => {
    const { pending, hot, warn } = setup()
    const error = new Error('worker update failed')
    const update = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined)
    pending.resolve(createRegistration(update))
    await setImmediate()
    expect(warn).toHaveBeenCalledWith('Failed to update mokup service worker:', error)
    hot.emit('mokup:routes-changed')
    await setImmediate()
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('runs another update for route changes received during an update', async () => {
    const { pending, hot } = setup()
    const firstUpdate = Promise.withResolvers<void>()
    const update = vi.fn().mockReturnValueOnce(firstUpdate.promise).mockResolvedValue(undefined)
    pending.resolve(createRegistration(update))
    await setImmediate()
    hot.emit('mokup:routes-changed')
    hot.emit('mokup:routes-changed')
    await setImmediate()
    expect(update).toHaveBeenCalledOnce()
    firstUpdate.resolve()
    await setImmediate()
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('only registers the service worker when HMR is unavailable', async () => {
    const { pending, register } = setup(false)
    const update = vi.fn().mockResolvedValue(undefined)
    pending.resolve(createRegistration(update))
    await setImmediate()
    expect(register).toHaveBeenCalledOnce()
    expect(update).not.toHaveBeenCalled()
  })

  it('accepts unsupported or disabled service worker registration', async () => {
    const { pending, hot, warn } = setup()
    pending.resolve(null)
    await setImmediate()
    hot.emit('mokup:routes-changed')
    await setImmediate()
    expect(warn).not.toHaveBeenCalled()
  })

  it('retains updates until a newly registered worker finishes installing', async () => {
    const { pending, hot, warn } = setup()
    const update = vi.fn().mockResolvedValue(undefined)
    const registration = createRegistration(update, false)
    pending.resolve(registration)
    hot.emit('mokup:routes-changed')
    await setImmediate()
    expect(update).not.toHaveBeenCalled()
    const worker = Object.assign(new EventTarget(), { state: 'installing' })
    registration.installing = worker
    registration.dispatchEvent(new Event('updatefound'))
    await setImmediate()
    expect(update).not.toHaveBeenCalled()
    worker.state = 'installed'
    registration.installing = null
    registration.waiting = worker
    worker.dispatchEvent(new Event('statechange'))
    await setImmediate()
    expect(update).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
  })

  it('removes registration and worker listeners when disposed during installation', async () => {
    const { pending, hot } = setup()
    const update = vi.fn().mockResolvedValue(undefined)
    const registration = createRegistration(update, false)
    const worker = Object.assign(new EventTarget(), { state: 'installing' })
    registration.installing = worker
    const removeRegistrationListener = vi.spyOn(registration, 'removeEventListener')
    const removeWorkerListener = vi.spyOn(worker, 'removeEventListener')
    pending.resolve(registration)
    await setImmediate()
    hot.close()
    expect(removeRegistrationListener).toHaveBeenCalledWith('updatefound', expect.any(Function))
    expect(removeWorkerListener).toHaveBeenCalledWith('statechange', expect.any(Function))
    worker.state = 'activated'
    registration.installing = null
    registration.active = worker
    worker.dispatchEvent(new Event('statechange'))
    registration.dispatchEvent(new Event('updatefound'))
    await setImmediate()
    expect(update).not.toHaveBeenCalled()
  })
})
