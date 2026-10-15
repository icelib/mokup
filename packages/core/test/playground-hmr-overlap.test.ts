import { setImmediate } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { injectPlaygroundHmr } from '../src/playground/inject'
import { createUpdateJob, runUpdateScript } from './helpers/sw-update-job'

function setup(registrations: object[]) {
  const html = injectPlaygroundHmr('', '/')
  const source = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'))
    .replace('import("/@vite/client")', 'loadClient()')
  return runUpdateScript(source, registrations)
}

describe.each(['active', 'waiting'] as const)('playground updates with an existing %s worker', (available) => {
  it.each(['installed', 'redundant'] as const)('retains changes until the installing job becomes %s', async (state) => {
    const job = createUpdateJob(available)
    const hot = await setup([job.registration])
    try {
      expect(job.update).toHaveBeenCalledOnce()
      job.revisions.server = 2
      hot.emit()
      await setImmediate()
      job.beginInstallation()
      await setImmediate()
      expect(job.update).toHaveBeenCalledOnce()
      hot.emit('vite:ws:connect')
      hot.emit()
      await setImmediate()
      expect(job.revisions).toEqual({ server: 2, fetched: 1, jobs: 1 })
      expect(job.update).toHaveBeenCalledOnce()
      job.finishInstallation(state)
      await setImmediate()
      expect(job.update).toHaveBeenCalledTimes(2)
      expect(job.revisions).toEqual({ server: 2, fetched: 2, jobs: 2 })
      expect(hot.warn).not.toHaveBeenCalled()
    }
    finally {
      hot.close()
      job.settle()
    }
  })

  it('removes installation listeners and drops pending updates on disposal', async () => {
    const job = createUpdateJob(available)
    const hot = await setup([job.registration])
    const removeRegistrationListener = vi.spyOn(job.registration, 'removeEventListener')
    hot.emit()
    const installing = job.beginInstallation()
    const removeWorkerListener = vi.spyOn(installing, 'removeEventListener')
    await setImmediate()
    hot.close()
    expect(removeRegistrationListener).toHaveBeenCalledWith('updatefound', expect.any(Function))
    expect(removeWorkerListener).toHaveBeenCalledWith('statechange', expect.any(Function))
    job.finishInstallation('installed')
    job.registration.dispatchEvent(new Event('updatefound'))
    hot.emit()
    await setImmediate()
    expect(job.update).toHaveBeenCalledOnce()
  })
})

it('continues updating other registrations while an existing worker installs a replacement', async () => {
  const job = createUpdateJob()
  void job.update()
  job.beginInstallation()
  const other = Object.assign(new EventTarget(), {
    installing: null,
    waiting: null,
    active: Object.assign(new EventTarget(), { state: 'activated' }),
    update: vi.fn().mockResolvedValue(undefined),
  })
  const hot = await setup([job.registration, other])
  try {
    expect(job.update).toHaveBeenCalledOnce()
    expect(other.update).toHaveBeenCalledOnce()
    hot.emit()
    await setImmediate()
    expect(job.update).toHaveBeenCalledOnce()
    expect(other.update).toHaveBeenCalledTimes(2)
    job.finishInstallation('installed')
    await setImmediate()
    expect(job.update).toHaveBeenCalledTimes(2)
  }
  finally {
    hot.close()
    job.settle()
  }
})
