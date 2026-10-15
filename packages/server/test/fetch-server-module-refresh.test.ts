import type { FetchServer } from '../src/fetch-server'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createFetchServer } from '../src/fetch-server'

vi.mock('../src/fetch-server/watcher', () => ({
  createWatcher: async () => ({ close: async () => {} }),
}))

describe('fetch server module refresh lifecycle', () => {
  it('drains an active module load before closing and preserves explicit refresh afterward', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mokup-refresh-module-'))
    const key = `mokup-refresh-${randomUUID()}`
    const globals = globalThis as typeof globalThis & Record<string, unknown>
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    globals[key] = { gate: gate.promise, entered: entered.resolve }
    let server: FetchServer | undefined
    let pending: Promise<void> | undefined
    try {
      await writeFile(join(directory, 'snapshot.get.json'), '{"version":"initial"}')
      server = await createFetchServer({ entries: { dir: directory, log: false }, playground: false })
      const response = (path: string) => server!.fetch(new Request(`http://localhost/${path}`)).then(value => value.json())
      expect(await response('snapshot')).toEqual({ version: 'initial' })

      await writeFile(join(directory, 'slow.get.mjs'), [
        `const state = globalThis[${JSON.stringify(key)}]`,
        'state.entered()',
        'await state.gate',
        'export default { handler: { version: "updated" } }',
      ].join('\n'))
      pending = server.refresh()
      await Promise.race([
        entered.promise,
        pending.then(() => {
          throw new Error('Refresh completed without loading the updated module')
        }),
      ])
      expect(await response('snapshot')).toEqual({ version: 'initial' })
      expect((await server.fetch(new Request('http://localhost/slow'))).status).toBe(404)

      const closed = vi.fn()
      expect(server.close).toBeTypeOf('function')
      const closing = server.close!().then(closed)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(closed).not.toHaveBeenCalled()

      gate.resolve()
      await Promise.all([pending, closing])
      expect(closed).toHaveBeenCalledOnce()
      expect(await response('slow')).toEqual({ version: 'updated' })

      await writeFile(join(directory, 'manual.get.json'), '{"version":"manual-after-close"}')
      await server.refresh()
      expect(await response('manual')).toEqual({ version: 'manual-after-close' })
    }
    finally {
      gate.resolve()
      try {
        try {
          await pending
        }
        finally {
          await server?.close?.()
        }
      }
      finally {
        delete globals[key]
        await rm(directory, { recursive: true, force: true })
      }
    }
  })
})
