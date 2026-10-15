import { setImmediate } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'
import { vi } from 'vitest'

type Worker = EventTarget & { state: string, revision: number }

export function createUpdateJob(available: 'active' | 'waiting' = 'active') {
  const previous = Object.assign(new EventTarget(), {
    state: available === 'active' ? 'activated' : 'installed',
    revision: 0,
  })
  const revisions = { server: 1, fetched: 0, jobs: 0 }
  let job: ReturnType<typeof Promise.withResolvers<void>> | undefined
  const update = vi.fn(() => {
    // A browser coalesces an update with its unfinished job, even after resolving its promise.
    if (job) {
      return job.promise
    }
    revisions.jobs++
    revisions.fetched = revisions.server
    job = Promise.withResolvers<void>()
    return job.promise
  })
  const registration = Object.assign(new EventTarget(), {
    update,
    installing: null as Worker | null,
    waiting: available === 'waiting' ? previous as Worker : null,
    active: available === 'active' ? previous as Worker : null,
  })
  return {
    registration,
    update,
    revisions,
    beginInstallation() {
      const worker = Object.assign(new EventTarget(), { state: 'installing', revision: revisions.fetched })
      registration.installing = worker
      job?.resolve()
      registration.dispatchEvent(new Event('updatefound'))
      return worker
    },
    finishInstallation(state: 'installed' | 'redundant') {
      const worker = registration.installing!
      job = undefined
      worker.state = state
      if (state === 'installed') {
        registration.installing = null
        registration.waiting = worker
      }
      // On failure, statechange may precede clearing the installing slot.
      worker.dispatchEvent(new Event('statechange'))
      if (state === 'installed' && available === 'waiting') {
        previous.state = 'redundant'
        previous.dispatchEvent(new Event('statechange'))
      }
    },
    settle() {
      job?.resolve()
      job = undefined
    },
  }
}

export async function runUpdateScript(source: string, registrations: object[]) {
  const listeners = new Map<string, () => void>()
  const disposers: (() => void)[] = []
  const hot = {
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    off: (event: string) => listeners.delete(event),
    dispose: (callback: () => void) => disposers.push(callback),
  }
  const warn = vi.fn()
  runInNewContext(source, {
    loadClient: async () => ({ createHotContext: () => hot }),
    mockHot: hot,
    registerMokupServiceWorker: async () => registrations[0],
    navigator: {
      serviceWorker: {
        getRegistrations: async () => registrations,
        ready: Promise.resolve(registrations[0]),
      },
    },
    window: { __MOKUP_PLAYGROUND__: { reloadRoutes() {} } },
    console: { warn },
  })
  await setImmediate()
  return {
    warn,
    emit: (event = 'mokup:routes-changed') => listeners.get(event)?.(),
    close: () => disposers.forEach(dispose => dispose()),
  }
}
