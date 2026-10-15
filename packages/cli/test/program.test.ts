import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runCli } from '../src/program'

const mocks = vi.hoisted(() => {
  return {
    buildManifest: vi.fn(),
    createFetchServer: vi.fn(),
    serve: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    },
  }
})

vi.mock('../src/manifest', () => ({
  buildManifest: mocks.buildManifest,
  checkManifest: vi.fn(),
}))

vi.mock('@mokup/server/node', () => ({
  createFetchServer: mocks.createFetchServer,
  serve: mocks.serve,
}))

vi.mock('@mokup/shared/logger', () => ({
  createLogger: () => mocks.logger,
}))

describe('cli program', () => {
  afterEach(() => {
    mocks.buildManifest.mockReset()
    mocks.createFetchServer.mockReset()
    mocks.serve.mockReset()
    mocks.logger.info.mockReset()
    mocks.logger.warn.mockReset()
    mocks.logger.error.mockReset()
    mocks.logger.log.mockReset()
    vi.restoreAllMocks()
  })

  it('runs build with collected options', async () => {
    mocks.buildManifest.mockResolvedValue(undefined)

    await runCli([
      'node',
      'mokup',
      'build',
      '--dir',
      'mock',
      '--out',
      '.mokup',
      '--prefix',
      '/api',
      '--include',
      '^foo',
      '--exclude',
      'bar$',
      '--ignore-prefix',
      '_',
      '--error-on',
      'invalid-route',
      '--error-on',
      'missing-handler',
      '--no-handlers',
    ])

    const [options] = mocks.buildManifest.mock.calls[0] ?? []
    expect(options).toEqual(
      expect.objectContaining({
        dir: ['mock'],
        outDir: '.mokup',
        prefix: '/api',
        include: [expect.any(RegExp)],
        exclude: [expect.any(RegExp)],
        ignorePrefix: ['_'],
        errorOn: ['invalid-route', 'missing-handler'],
        handlers: false,
        log: expect.any(Function),
      }),
    )
    expect(options.include[0].source).toBe('^foo')
    expect(options.exclude[0].source).toBe('bar$')
  })

  it('invokes build log output', async () => {
    mocks.buildManifest.mockImplementation(async (options) => {
      options.log?.('hello')
      return undefined
    })

    await runCli(['node', 'mokup', 'build', '--dir', 'mock'])

    expect(mocks.logger.info).toHaveBeenCalledWith('hello')
  })

  it('runs build without explicit dirs', async () => {
    mocks.buildManifest.mockResolvedValue(undefined)

    await runCli(['node', 'mokup', 'build'])

    const [options] = mocks.buildManifest.mock.calls[0] ?? []
    expect(options.dir).toBeUndefined()
  })

  it('normalizes build errorOn all mode', async () => {
    mocks.buildManifest.mockResolvedValue(undefined)

    await runCli([
      'node',
      'mokup',
      'build',
      '--error-on',
      'invalid-route',
      '--error-on',
      'all',
    ])

    const [options] = mocks.buildManifest.mock.calls[0] ?? []
    expect(options.errorOn).toBe('all')
  })

  it('rejects invalid build errorOn category', async () => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    await expect(
      runCli(['node', 'mokup', 'build', '--error-on', 'not-a-category']),
    ).rejects.toThrow(/Invalid diagnostic category "not-a-category"/)
  })

  it('runs serve and registers shutdown handlers', async () => {
    const nodeServer = { close: vi.fn((cb?: (error?: Error) => void) => cb?.()) }
    const mockServer = {
      fetch: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      websocket: { server: { options: { noServer: true } } },
    }
    mocks.createFetchServer.mockResolvedValue(mockServer)
    mocks.serve.mockImplementation((_options, callback) => {
      callback?.({ address: '0.0.0.0', port: 9090 })
      return nodeServer
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const handlers = new Map<string, () => Promise<void>>()
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => Promise<void>) => {
      handlers.set(event, handler)
      return process
    }) as never)

    await runCli([
      'node',
      'mokup',
      'serve',
      '--dir',
      'mock',
      '--prefix',
      '/api',
      '--include',
      '^foo',
      '--exclude',
      'bar$',
      '--ignore-prefix',
      '_',
      '--error-on',
      'invalid-route',
      '--host',
      '0.0.0.0',
      '--port',
      '9090',
      '--no-watch',
      '--no-playground',
      '--no-log',
    ])

    expect(mocks.createFetchServer).toHaveBeenCalledWith({
      entries: expect.objectContaining({
        dir: ['mock'],
        prefix: '/api',
        include: [expect.any(RegExp)],
        exclude: [expect.any(RegExp)],
        ignorePrefix: ['_'],
        errorOn: ['invalid-route'],
        host: '0.0.0.0',
        port: 9090,
        watch: false,
        log: false,
      }),
      playground: false,
    })
    expect(mocks.serve).toHaveBeenCalled()
    expect(mocks.serve).toHaveBeenCalledWith(
      expect.objectContaining({ websocket: mockServer.websocket }),
      expect.any(Function),
    )

    const shutdown = handlers.get('SIGINT')
    await shutdown?.()

    expect(mockServer.close).toHaveBeenCalled()
    expect(nodeServer.close).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('logs playground URL when enabled', async () => {
    const nodeServer = { close: vi.fn((cb?: (error?: Error) => void) => cb?.()) }
    const mockServer = {
      fetch: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mocks.createFetchServer.mockResolvedValue(mockServer)
    mocks.serve.mockImplementation((_options, callback) => {
      callback?.('ready')
      return nodeServer
    })

    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.spyOn(process, 'on').mockImplementation(((_event: string, handler: () => Promise<void>) => {
      void handler
      return process
    }) as never)

    await runCli(['node', 'mokup', 'serve', '--dir', 'mock'])

    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Playground at http://localhost:8080/__mokup',
    )
  })

  it('falls back to default host and port when server info is incomplete', async () => {
    const nodeServer = { close: vi.fn((cb?: (error?: Error) => void) => cb?.()) }
    const mockServer = {
      fetch: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mocks.createFetchServer.mockResolvedValue(mockServer)
    mocks.serve.mockImplementation((_options, callback) => {
      callback?.({})
      return nodeServer
    })

    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.spyOn(process, 'on').mockImplementation(((_event: string, handler: () => Promise<void>) => {
      void handler
      return process
    }) as never)

    await runCli(['node', 'mokup', 'serve'])

    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Mock server ready at http://localhost:8080',
    )
  })

  it('normalizes serve errorOn all mode', async () => {
    const nodeServer = { close: vi.fn((cb?: (error?: Error) => void) => cb?.()) }
    const mockServer = {
      fetch: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mocks.createFetchServer.mockResolvedValue(mockServer)
    mocks.serve.mockImplementation((_options, callback) => {
      callback?.({})
      return nodeServer
    })

    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.spyOn(process, 'on').mockImplementation(((_event: string, handler: () => Promise<void>) => {
      void handler
      return process
    }) as never)

    await runCli(['node', 'mokup', 'serve', '--error-on', 'invalid-route', '--error-on', 'all'])

    expect(mocks.createFetchServer).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.objectContaining({
          errorOn: 'all',
        }),
      }),
    )
  })

  it('rejects invalid serve errorOn category', async () => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    await expect(
      runCli(['node', 'mokup', 'serve', '--error-on', 'not-a-category']),
    ).rejects.toThrow(/Invalid diagnostic category "not-a-category"/)
  })

  it('propagates shutdown errors and still exits', async () => {
    const nodeServer = {
      close: vi.fn((cb?: (error?: Error) => void) => cb?.(new Error('boom'))),
    }
    const mockServer = {
      fetch: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    mocks.createFetchServer.mockResolvedValue(mockServer)
    mocks.serve.mockImplementation((_options, callback) => {
      callback?.({ address: '127.0.0.1', port: 9090 })
      return nodeServer
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const handlers = new Map<string, () => Promise<void>>()
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => Promise<void>) => {
      handlers.set(event, handler)
      return process
    }) as never)

    await runCli(['node', 'mokup', 'serve', '--dir', 'mock'])

    const shutdown = handlers.get('SIGTERM')
    await expect(shutdown?.()).rejects.toThrow('boom')
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('shuts down when server close handler is missing', async () => {
    const nodeServer = { close: vi.fn((cb?: (error?: Error) => void) => cb?.()) }
    const mockServer = {
      fetch: vi.fn(),
    }
    mocks.createFetchServer.mockResolvedValue(mockServer)
    mocks.serve.mockImplementation((_options, callback) => {
      callback?.({ address: '127.0.0.1', port: 3000 })
      return nodeServer
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const handlers = new Map<string, () => Promise<void>>()
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => Promise<void>) => {
      handlers.set(event, handler)
      return process
    }) as never)

    await runCli(['node', 'mokup', 'serve'])

    await handlers.get('SIGINT')?.()
    expect(nodeServer.close).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('shows help when no args are provided', async () => {
    const helpSpy = vi.spyOn(Command.prototype, 'help').mockImplementation(() => undefined as never)

    await runCli(['node', 'mokup'])

    expect(helpSpy).toHaveBeenCalled()
  })

  it('runs help command', async () => {
    const helpSpy = vi.spyOn(Command.prototype, 'help').mockImplementation(() => undefined as never)

    await runCli(['node', 'mokup', 'help'])

    expect(helpSpy).toHaveBeenCalled()
  })

  it('throws on invalid port', async () => {
    await expect(
      runCli(['node', 'mokup', 'serve', '--port', 'oops']),
    ).rejects.toThrow('Invalid port')
  })
})
