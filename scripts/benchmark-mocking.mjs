import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
// eslint-disable-next-line antfu/no-import-dist -- Benchmark the release build without TypeScript loader overhead.
import { scanRoutes } from '../packages/core/dist/index.mjs'
// eslint-disable-next-line antfu/no-import-dist -- Benchmark the release build.
import { createMockSession, http, HttpResponse } from '../packages/runtime/dist/http.mjs'
// eslint-disable-next-line antfu/no-import-dist -- Benchmark the release build.
import { createRuntime } from '../packages/runtime/dist/index.mjs'

const rows = []
for (const count of [100, 1000]) {
  const directory = await mkdtemp(join(tmpdir(), 'mokup-benchmark-'))
  const session = createMockSession(...Array.from({ length: count }, (_, index) => http.get(`/routes/${index}`, () => HttpResponse.text('ok'))))
  try {
    const durations = []
    for (let index = 0; index < 220; index++) {
      const start = performance.now()
      const response = await session.handle(new Request(`http://bench.local/routes/${count - 1}`))
      assert.equal(await response.text(), 'ok')
      if (index >= 20) {
        durations.push(performance.now() - start)
      }
    }
    durations.sort((left, right) => left - right)
    const manifest = { version: 1, routes: Array.from({ length: count }, (_, index) => ({ method: 'GET', url: `/routes/${index}`, response: { type: 'text', body: 'ok' } })) }
    const coldStart = performance.now()
    const runtime = createRuntime({ manifest })
    assert.equal(await (await runtime.fetch(new Request('http://bench.local/routes/0'))).text(), 'ok')
    const coldMs = performance.now() - coldStart
    await runtime.close()
    await Promise.all(Array.from({ length: count }, (_, index) => writeFile(join(directory, `${index}.get.json`), JSON.stringify({ id: index }))))
    const options = { dirs: [directory], prefix: '', logger: { info() {}, warn() {}, error() {} } }
    const scanStart = performance.now()
    assert.equal((await scanRoutes(options)).length, count)
    const scanMs = performance.now() - scanStart
    await writeFile(join(directory, '0.get.json'), '{"changed":true}')
    const refreshStart = performance.now()
    assert.equal((await scanRoutes(options)).length, count)
    const refreshMs = performance.now() - refreshStart
    rows.push({ routes: count, requestP50Ms: durations[100], requestP95Ms: durations[190], coldMs, scanMs, rescanAfterOneChangeMs: refreshMs })
  }
  finally {
    await session.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}
process.stdout.write(`${JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, rows }, null, 2)}\n`)
