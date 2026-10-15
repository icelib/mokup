import type { CheckResult } from '../src/manifest/types'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCli, runCli } from '../src/program'

const mocks = vi.hoisted(() => ({
  checkManifest: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  },
}))

vi.mock('../src/manifest', () => ({
  buildManifest: vi.fn(),
  checkManifest: mocks.checkManifest,
}))

vi.mock('@mokup/shared/logger', () => ({
  createLogger: () => mocks.logger,
}))

const diagnostics: CheckResult['diagnostics'] = [{
  category: 'missing-handler',
  label: 'routes skipped without handler',
  count: 1,
  items: ['mock/users.get.ts'],
  advice: 'Export a handler value or function for every enabled rule.',
}]

describe('check command', () => {
  let originalExitCode: typeof process.exitCode
  let output: string[]
  let errors: string[]

  beforeEach(() => {
    originalExitCode = process.exitCode
    output = []
    errors = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk))
      return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errors.push(String(chunk))
      return true
    })
    mocks.checkManifest.mockResolvedValue({
      schemaVersion: 1,
      valid: true,
      routeCount: 1,
      diagnostics: [],
    } satisfies CheckResult)
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    vi.resetAllMocks()
    vi.restoreAllMocks()
  })

  it('uses API defaults and clears a previous failure exit code', async () => {
    process.exitCode = 1

    expect(await runCli(['node', 'mokup', 'check'])).toBeUndefined()

    expect(mocks.checkManifest).toHaveBeenCalledExactlyOnceWith({})
    expect(output).toEqual(['Mokup check passed: 1 route.\n'])
    expect(errors).toEqual([])
    expect(process.exitCode).toBe(0)
  })

  it('passes only scan options and collects repeated flags', async () => {
    await runCli([
      'node',
      'mokup',
      'check',
      '--dir',
      'mock',
      '--dir',
      'fixtures',
      '--root',
      '/project',
      '--prefix',
      '/api',
      '--include',
      '^users',
      '--include',
      '^posts',
      '--exclude',
      'private',
      '--exclude',
      'internal',
      '--ignore-prefix',
      '_',
      '--ignore-prefix',
      '.',
      '--error-on',
      'invalid-route',
      '--error-on',
      'missing-handler',
      '--json',
    ])

    expect(mocks.checkManifest).toHaveBeenCalledExactlyOnceWith({
      dir: ['mock', 'fixtures'],
      root: '/project',
      prefix: '/api',
      include: [/^users/, /^posts/],
      exclude: [/private/, /internal/],
      ignorePrefix: ['_', '.'],
      errorOn: ['invalid-route', 'missing-handler'],
    })
  })

  it('normalizes an explicit all diagnostic category', async () => {
    await runCli([
      'node',
      'mokup',
      'check',
      '--error-on',
      'invalid-route',
      '--error-on',
      'all',
    ])

    expect(mocks.checkManifest).toHaveBeenCalledExactlyOnceWith({ errorOn: 'all' })
  })

  it.each([true, false])('prints one JSON report with valid=%s and no log noise', async (valid) => {
    const result: CheckResult = {
      schemaVersion: 1,
      valid,
      routeCount: 2,
      diagnostics,
    }
    mocks.checkManifest.mockResolvedValue(result)

    await runCli(['node', 'mokup', 'check', '--json'])

    expect(output).toEqual([`${JSON.stringify(result)}\n`])
    expect(JSON.parse(output.join(''))).toEqual(result)
    expect(errors).toEqual([])
    expect(process.exitCode).toBe(valid ? 0 : 1)
    for (const log of Object.values(mocks.logger)) {
      expect(log).not.toHaveBeenCalled()
    }
  })

  it('prints a failed check summary with actionable diagnostics', async () => {
    mocks.checkManifest.mockResolvedValue({
      schemaVersion: 1,
      valid: false,
      routeCount: 2,
      diagnostics,
    } satisfies CheckResult)

    await runCli(['node', 'mokup', 'check'])

    expect(output).toEqual([
      'Mokup check failed: 2 routes.\n'
      + 'Mokup diagnostics summary: 1 routes skipped without handler\n'
      + 'routes skipped without handler: mock/users.get.ts\n'
      + 'Fix: Export a handler value or function for every enabled rule.\n',
    ])
    expect(process.exitCode).toBe(1)
  })

  it.each([
    new Error('Mock directory does not exist: missing'),
    'Cannot scan mock directory',
  ])('turns an operational error into a JSON failure report', async (error) => {
    mocks.checkManifest.mockRejectedValue(error)
    const result: CheckResult = {
      schemaVersion: 1,
      valid: false,
      routeCount: 0,
      diagnostics: [],
      error: { message: error instanceof Error ? error.message : error },
    }

    await runCli(['node', 'mokup', 'check', '--json'])

    expect(output).toEqual([`${JSON.stringify(result)}\n`])
    expect(errors).toEqual([])
    expect(process.exitCode).toBe(1)
  })

  it('prints an operational error in the text summary', async () => {
    mocks.checkManifest.mockRejectedValue(new Error('Cannot parse mock/users.get.json'))

    await runCli(['node', 'mokup', 'check'])

    expect(output).toEqual([
      'Mokup check failed: 0 routes.\nError: Cannot parse mock/users.get.json\n',
    ])
    expect(process.exitCode).toBe(1)
  })

  it('leaves invalid diagnostic categories to Commander', async () => {
    const program = createCli().exitOverride()
    program.commands.forEach(command => command.exitOverride())

    await expect(program.parseAsync([
      'node',
      'mokup',
      'check',
      '--json',
      '--error-on',
      'unknown',
    ])).rejects.toThrow('Invalid diagnostic category "unknown"')

    expect(mocks.checkManifest).not.toHaveBeenCalled()
    expect(output).toEqual([])
    expect(errors.join('')).toContain('Invalid diagnostic category "unknown"')
  })

  it.each(['--out', '--no-handlers'])('does not accept the build-only %s option', async (option) => {
    const program = createCli().exitOverride()
    program.commands.forEach(command => command.exitOverride())

    await expect(program.parseAsync([
      'node',
      'mokup',
      'check',
      '--json',
      option,
    ])).rejects.toThrow(`unknown option '${option}'`)

    expect(mocks.checkManifest).not.toHaveBeenCalled()
    expect(output).toEqual([])
  })
})
