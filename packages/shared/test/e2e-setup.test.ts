import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import globalSetup from '../../../tests/e2e/global-setup'
import { startViteServer } from '../../../tests/e2e/utils/servers'

vi.mock('../../../tests/e2e/utils/servers', async (importOriginal) => {
  return {
    ...await importOriginal<typeof import('../../../tests/e2e/utils/servers')>(),
    startViteServer: vi.fn(),
  }
})

let child: ChildProcess | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(5_000) })
    child.kill('SIGKILL')
    await exited
  }
  child = undefined
})

describe('E2E setup cleanup', () => {
  it('stops the first owned server when starting the second fails', async () => {
    vi.stubEnv('MOKUP_E2E_SKIP_BUILD', '1')
    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000); process.send("ready")'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    await once(child, 'message', { signal: AbortSignal.timeout(5_000) })
    const failure = new Error('Second server failed to start')
    vi.mocked(startViteServer)
      .mockResolvedValueOnce({ name: 'first', process: child, url: 'http://127.0.0.1:1' })
      .mockRejectedValueOnce(failure)
    await expect(globalSetup()).rejects.toBe(failure)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  })

  it('preserves startup and cleanup errors when both fail', async () => {
    vi.stubEnv('MOKUP_E2E_SKIP_BUILD', '1')
    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000); process.send("ready")'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    await once(child, 'message', { signal: AbortSignal.timeout(5_000) })
    const startupFailure = new Error('Second server failed to start')
    const cleanupFailure = new Error('First server could not be stopped')
    vi.spyOn(child, 'kill').mockImplementation(() => {
      throw cleanupFailure
    })
    vi.mocked(startViteServer)
      .mockResolvedValueOnce({ name: 'first', process: child, url: 'http://127.0.0.1:1' })
      .mockRejectedValueOnce(startupFailure)
    await expect(globalSetup()).rejects.toMatchObject({
      errors: [
        startupFailure,
        expect.objectContaining({ errors: [expect.objectContaining({ cause: cleanupFailure })] }),
      ],
    })
  })
})
