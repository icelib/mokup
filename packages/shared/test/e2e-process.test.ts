import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stopProcess } from '../../../tests/e2e/utils/process.mjs'
import { stopServers } from '../../../tests/e2e/utils/servers'

const children = new Set<ChildProcess>()
const isWindows = process.platform === 'win32'

function hasExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null
}

async function startChild(ignoreTerm = false) {
  const child = spawn(process.execPath, ['-e', `
    process.on('SIGTERM', () => { ${ignoreTerm ? '' : 'process.exit(0)'} });
    process.on('message', () => process.exit(0));
    setInterval(() => {}, 1000);
    process.send('ready');
  `], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  children.add(child)
  await once(child, 'message', { signal: AbortSignal.timeout(5_000) })
  return child
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all([...children].map(async (child) => {
    if (!hasExited(child)) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5_000) })
      child.kill('SIGKILL')
      await exited
    }
  }))
  children.clear()
})

describe('E2E process cleanup', () => {
  it('waits for real exit and shares concurrent cleanup', async () => {
    const child = await startChild()
    const listeners = { exit: child.listenerCount('exit'), error: child.listenerCount('error') }
    const kill = vi.spyOn(child, 'kill')
    const first = stopProcess(child)
    const second = stopProcess(child)
    expect(second).toBe(first)
    await first
    expect(hasExited(child)).toBe(true)
    expect(kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    expect(child.listenerCount('exit')).toBe(listeners.exit)
    expect(child.listenerCount('error')).toBe(listeners.error)
  })

  it.skipIf(isWindows)('escalates when a real process ignores SIGTERM', async () => {
    const child = await startChild(true)
    const kill = vi.spyOn(child, 'kill')
    await stopProcess(child, { graceMs: 50, forceMs: 1_000 })
    expect(child.signalCode).toBe('SIGKILL')
    expect(kill.mock.calls.map(call => call[0])).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('handles a process that already exited by a signal', async () => {
    const child = await startChild(true)
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    expect(child.exitCode).toBeNull()
    expect(child.signalCode).toBe('SIGKILL')
    const kill = vi.spyOn(child, 'kill')
    await stopProcess(child)
    expect(kill).not.toHaveBeenCalled()
  })

  it('cleans remaining processes before reporting a termination failure', async () => {
    const [failing, other] = await Promise.all([startChild(), startChild()])
    const failure = new Error('Cannot signal owned process')
    vi.spyOn(failing, 'kill').mockImplementation(() => {
      throw failure
    })
    const result = stopServers([
      { name: 'failing', process: failing, url: 'http://127.0.0.1:1' },
      { name: 'other', process: other, url: 'http://127.0.0.1:2' },
    ])
    await expect(result).rejects.toMatchObject({
      errors: [expect.objectContaining({ cause: failure })],
    })
    expect(hasExited(other)).toBe(true)
    expect(failing.listenerCount('exit')).toBe(0)
    expect(failing.listenerCount('error')).toBe(0)
  })

  it('reports a bounded failure if a signaled process never exits', async () => {
    const child = await startChild(true)
    // Simulate an OS accepting signals without delivering them to the real child.
    vi.spyOn(child, 'kill').mockReturnValue(true)
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout')
    await expect(stopProcess(child, { graceMs: 10, forceMs: 10 })).rejects.toThrow(`Process ${child.pid} did not exit within 10ms after SIGKILL`)
    expect(hasExited(child)).toBe(false)
    expect(child.listenerCount('exit')).toBe(0)
    expect(child.listenerCount('error')).toBe(0)
    for (const timer of timers.mock.results) {
      expect(clearTimer).toHaveBeenCalledWith(timer.value)
    }
  })

  it.each(isWindows ? [false] : [false, true])('clears cleanup timers after exit (ignore SIGTERM: %s)', async (ignoreTerm) => {
    const child = await startChild(ignoreTerm)
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const clearTimer = vi.spyOn(globalThis, 'clearTimeout')
    await stopProcess(child, { graceMs: ignoreTerm ? 50 : 30_000, forceMs: 30_000 })
    expect(hasExited(child)).toBe(true)
    expect(timers.mock.results.length).toBeGreaterThan(0)
    for (const timer of timers.mock.results) {
      expect(clearTimer).toHaveBeenCalledWith(timer.value)
    }
  })
})
