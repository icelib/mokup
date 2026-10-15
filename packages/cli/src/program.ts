import type { FetchServerOptions, FetchServerOptionsConfig } from '@mokup/server/node'
import type { ScanCommandOptions } from './command-options'
import type { BuildOptions } from './manifest/types'
import process from 'node:process'
import { createLogger } from '@mokup/shared/logger'
import { Command } from 'commander'
import { registerCheckCommand } from './check-command'
import {
  collectDiagnosticCategory,
  collectRegex,
  collectValues,
  diagnosticCategoryHelp,
  toScanOptions,
} from './command-options'
import { buildManifest } from './manifest'

const logger = createLogger()

function toBuildOptions(options: ScanCommandOptions & {
  out?: string
  handlers?: boolean
}) {
  const buildOptions: BuildOptions = {
    ...toScanOptions(options),
    handlers: options.handlers !== false,
    log: (message: string) => {
      logger.info(message)
    },
  }
  if (options.out) {
    buildOptions.outDir = options.out
  }
  return buildOptions
}

function toServeOptions(options: ScanCommandOptions & {
  host?: string
  port?: string
  watch?: boolean
  playground?: boolean
  log?: boolean
}): { entry: FetchServerOptions, playground?: FetchServerOptionsConfig['playground'] } {
  const serveOptions: FetchServerOptions = {
    ...toScanOptions(options),
    watch: options.watch !== false,
    log: options.log !== false,
  }
  if (options.host) {
    serveOptions.host = options.host
  }
  if (typeof options.port === 'string' && options.port.length > 0) {
    const parsed = Number(options.port)
    if (!Number.isFinite(parsed)) {
      throw new TypeError(`Invalid port: ${options.port}`)
    }
    serveOptions.port = parsed
  }
  return {
    entry: serveOptions,
    playground: options.playground,
  }
}

/**
 * Create the mokup CLI program instance.
 *
 * @returns A configured CLI program.
 *
 * @example
 * import { createCli } from '@mokup/cli'
 *
 * const cli = createCli()
 */
export function createCli() {
  const program = new Command()
  program
    .name('mokup')
    .description('Mock utilities for file-based routes.')
    .showHelpAfterError()

  registerCheckCommand(program)

  program
    .command('build')
    .description('Generate .mokup build output')
    .option('-d, --dir <dir>', 'Mock directory (repeatable)', collectValues)
    .option('-o, --out <dir>', 'Output directory (default: .mokup)')
    .option('--prefix <prefix>', 'URL prefix')
    .option('--include <pattern>', 'Include regex (repeatable)', collectRegex)
    .option('--exclude <pattern>', 'Exclude regex (repeatable)', collectRegex)
    .option('--ignore-prefix <prefix>', 'Ignore path segment prefix (repeatable)', collectValues)
    .option(
      '--error-on <category>',
      `Fail build on selected diagnostics (repeatable: ${diagnosticCategoryHelp})`,
      collectDiagnosticCategory,
    )
    .option('--no-handlers', 'Skip function handler output')
    .action(async (options) => {
      const buildOptions = toBuildOptions(options)
      await buildManifest(buildOptions)
    })

  program
    .command('serve')
    .description('Start a Node.js mock server')
    .option('-d, --dir <dir>', 'Mock directory (repeatable)', collectValues)
    .option('--prefix <prefix>', 'URL prefix')
    .option('--include <pattern>', 'Include regex (repeatable)', collectRegex)
    .option('--exclude <pattern>', 'Exclude regex (repeatable)', collectRegex)
    .option('--ignore-prefix <prefix>', 'Ignore path segment prefix (repeatable)', collectValues)
    .option(
      '--error-on <category>',
      `Fail serve startup on selected diagnostics (repeatable: ${diagnosticCategoryHelp})`,
      collectDiagnosticCategory,
    )
    .option('--host <host>', 'Hostname (default: localhost)')
    .option('--port <port>', 'Port (default: 8080)')
    .option('--no-watch', 'Disable file watching')
    .option('--no-playground', 'Disable Playground')
    .option('--no-log', 'Disable logging')
    .action(async (options) => {
      const { createFetchServer, serve } = await import('@mokup/server/node')
      const serveOptions = toServeOptions(options)
      const { entry, playground } = serveOptions
      const host = entry.host ?? 'localhost'
      const port = entry.port ?? 8080
      const playgroundEnabled = playground !== false
      const playgroundPath = '/__mokup'
      const server = await createFetchServer({
        entries: entry,
        playground,
      })
      const nodeServer = serve(
        {
          fetch: server.fetch,
          hostname: host,
          port,
          ...(server.websocket ? { websocket: server.websocket } : {}),
        },
        (info) => {
          const resolvedHost = typeof info === 'string' ? host : info?.address ?? host
          const resolvedPort = typeof info === 'string' ? port : info?.port ?? port
          logger.info(`Mock server ready at http://${resolvedHost}:${resolvedPort}`)
          if (playgroundEnabled) {
            logger.info(`Playground at http://${resolvedHost}:${resolvedPort}${playgroundPath}`)
          }
        },
      )
      const shutdown = async () => {
        try {
          if (server.close) {
            await server.close()
          }
          await new Promise<void>((resolve, reject) => {
            nodeServer.close((error?: Error) => {
              if (error) {
                reject(error)
                return
              }
              resolve()
            })
          })
        }
        finally {
          process.exit(0)
        }
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })

  program
    .command('help')
    .description('Show help')
    .action(() => {
      program.help()
    })

  return program
}

/**
 * Run the mokup CLI with the provided argv.
 *
 * @param argv - CLI arguments.
 * @returns Resolves when the command completes.
 *
 * @example
 * import { runCli } from '@mokup/cli'
 *
 * await runCli(['node', 'mokup', 'build', '--dir', 'mock'])
 */
export async function runCli(argv = process.argv) {
  const program = createCli()
  if (argv.length <= 2) {
    program.help()
    return
  }
  await program.parseAsync(argv)
}
