import type { CheckOptions, DiagnosticCategory } from './manifest/types'
import { diagnosticCategories, isDiagnosticCategory } from '@mokup/shared'
import { InvalidArgumentError } from 'commander'

export interface ScanCommandOptions {
  dir?: string[]
  root?: string
  prefix?: string
  include?: RegExp[]
  exclude?: RegExp[]
  ignorePrefix?: string[]
  errorOn?: string[]
}

export const diagnosticCategoryHelp = [...diagnosticCategories, 'all'].join(', ')

export function collectValues(value: string, previous: string[] | undefined) {
  return [...(previous ?? []), value]
}

export function collectRegex(value: string, previous: RegExp[] | undefined) {
  return [...(previous ?? []), new RegExp(value)]
}

export function collectDiagnosticCategory(value: string, previous: string[] | undefined) {
  if (value !== 'all' && !isDiagnosticCategory(value)) {
    throw new InvalidArgumentError(
      `Invalid diagnostic category "${value}". Expected one of: ${diagnosticCategoryHelp}`,
    )
  }
  return [...(previous ?? []), value]
}

export function toScanOptions(options: ScanCommandOptions): CheckOptions {
  const scanOptions: CheckOptions = {}
  if (options.dir?.length) {
    scanOptions.dir = options.dir
  }
  if (options.root) {
    scanOptions.root = options.root
  }
  if (options.prefix) {
    scanOptions.prefix = options.prefix
  }
  if (options.include?.length) {
    scanOptions.include = options.include
  }
  if (options.exclude?.length) {
    scanOptions.exclude = options.exclude
  }
  if (options.ignorePrefix?.length) {
    scanOptions.ignorePrefix = options.ignorePrefix
  }
  if (options.errorOn?.length) {
    scanOptions.errorOn = options.errorOn.includes('all')
      ? 'all'
      : options.errorOn as DiagnosticCategory[]
  }
  return scanOptions
}
