import type { Command } from 'commander'
import type { ScanCommandOptions } from './command-options'
import type { CheckResult } from './manifest/types'
import process from 'node:process'
import { buildDiagnosticSummaryLines } from '@mokup/shared/diagnostics'
import {
  collectDiagnosticCategory,
  collectRegex,
  collectValues,
  diagnosticCategoryHelp,
  toScanOptions,
} from './command-options'
import { checkManifest } from './manifest'

interface CheckCommandOptions extends ScanCommandOptions {
  json?: boolean
}

async function runCheck(options: CheckCommandOptions): Promise<void> {
  let result: CheckResult
  try {
    result = await checkManifest(toScanOptions(options))
  }
  catch (error) {
    result = {
      schemaVersion: 1,
      valid: false,
      routeCount: 0,
      diagnostics: [],
      error: { message: error instanceof Error ? error.message : String(error) },
    }
  }

  process.exitCode = result.valid ? 0 : 1
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return
  }

  const lines = [
    `Mokup check ${result.valid ? 'passed' : 'failed'}: ${result.routeCount} ${result.routeCount === 1 ? 'route' : 'routes'}.`,
    ...buildDiagnosticSummaryLines({ sections: result.diagnostics }),
  ]
  if (result.error) {
    lines.push(`Error: ${result.error.message}`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Validate mock routes without writing build output')
    .option('-d, --dir <dir>', 'Mock directory (repeatable)', collectValues)
    .option('--root <dir>', 'Project root (default: current directory)')
    .option('--prefix <prefix>', 'URL prefix')
    .option('--include <pattern>', 'Include regex (repeatable)', collectRegex)
    .option('--exclude <pattern>', 'Exclude regex (repeatable)', collectRegex)
    .option('--ignore-prefix <prefix>', 'Ignore path segment prefix (repeatable)', collectValues)
    .option(
      '--error-on <category>',
      `Fail on selected diagnostics (default: all; repeatable: ${diagnosticCategoryHelp})`,
      collectDiagnosticCategory,
    )
    .option('--json', 'Print a JSON report')
    .action(runCheck)
}
