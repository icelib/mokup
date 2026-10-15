import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

it('contains delayed Node destruction errors and releases guards after destruction', async () => {
  const moduleUrl = new URL('../src/stream-body.ts', import.meta.url).href
  const source = `
    import assert from 'node:assert/strict'
    import { Readable } from 'node:stream'
    import { setTimeout as wait } from 'node:timers/promises'
    import { readStreamBody } from ${JSON.stringify(moduleUrl)}
    const failure = new Error('delayed destruction error')
    function delayedStream(options = {}) {
      return new Readable({
        read() { this.push('body'); this.push(null) },
        destroy(error, done) { setTimeout(() => done(error ?? failure), 20) },
        ...options,
      })
    }
    const closed = stream => new Promise(resolve => stream.once('close', resolve))
    async function noGuard(stream) {
      const deadline = Date.now() + 1000
      while (stream.listenerCount('error') || stream.listenerCount('close')) {
        assert.ok(Date.now() < deadline, 'Reader guard was not released')
        await wait(1)
      }
    }
    {
      const stream = delayedStream()
      const closing = closed(stream)
      try {
        stream.destroy(failure)
        await assert.rejects(readStreamBody(stream), error => error === failure)
        await closing
        await noGuard(stream)
      } finally { stream.destroy() }
    }
    {
      const stream = delayedStream()
      const closing = closed(stream)
      try {
        assert.equal(new TextDecoder().decode(await readStreamBody(stream)), 'body')
        await closing
        await noGuard(stream)
      } finally { stream.destroy() }
    }
    {
      const stream = delayedStream()
      const closing = closed(stream)
      const body = new Promise((resolve, reject) => {
        stream.once('end', () => { readStreamBody(stream).then(resolve, reject) })
      })
      try {
        stream.resume()
        assert.equal(await body, null)
        await closing
        await noGuard(stream)
      } finally { stream.destroy() }
    }
    {
      let destroyed
      const destruction = new Promise(resolve => { destroyed = resolve })
      const stream = delayedStream({
        emitClose: false,
        destroy(error, done) { setTimeout(() => { done(error); destroyed() }, 20) },
      })
      try {
        stream.destroy()
        await assert.rejects(readStreamBody(stream), { code: 'ERR_STREAM_PREMATURE_CLOSE' })
        await destruction
        assert.equal(stream.closed, true)
        await noGuard(stream)
      } finally { stream.destroy() }
    }
    {
      const stream = delayedStream({ autoDestroy: false, destroy(error, done) { done(error) } })
      try {
        assert.equal(new TextDecoder().decode(await readStreamBody(stream)), 'body')
        await noGuard(stream)
        assert.equal(stream.destroyed, false)
        assert.equal(stream.closed, false)
      } finally { stream.destroy() }
    }
    process.stdout.write('Node stream destruction checks passed')
  `
  const result = await execFileAsync(process.execPath, [
    '--unhandled-rejections=strict',
    '--import',
    'tsx',
    '--input-type=module',
    '-e',
    source,
  ], { timeout: 15000 })

  expect(result.stdout).toContain('Node stream destruction checks passed')
}, 20000)
