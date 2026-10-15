import { setImmediate } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { createUpdateJob, runUpdateScript } from '../../core/test/helpers/sw-update-job'
import { buildSwLifecycleScript as buildViteScript } from '../src/vite/plugin/sw'
import { buildSwLifecycleScript as buildWebpackScript } from '../src/webpack/plugin/sw'

describe.each([
  ['vite', buildViteScript],
  ['webpack', buildWebpackScript],
] as const)('%s installation overlap', (_, buildScript) => {
  function setup(registration: object) {
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
    return runUpdateScript(source, [registration])
  }

  describe.each(['active', 'waiting'] as const)('with an existing %s worker', (available) => {
    it.each(['installed', 'redundant'] as const)('checks again after the installing job becomes %s', async (state) => {
      const job = createUpdateJob(available)
      const hot = await setup(job.registration)
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
        expect(job.update).toHaveBeenCalledOnce()
        expect(job.revisions).toEqual({ server: 2, fetched: 1, jobs: 1 })
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

    it('does not update after disposal during installation', async () => {
      const job = createUpdateJob(available)
      const hot = await setup(job.registration)
      const removeRegistrationListener = vi.spyOn(job.registration, 'removeEventListener')
      hot.emit()
      const worker = job.beginInstallation()
      const removeWorkerListener = vi.spyOn(worker, 'removeEventListener')
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
})
