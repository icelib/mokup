import type { Command } from 'commander'
import { Buffer } from 'node:buffer'
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { matchRouteTokens, parseRouteTemplate } from '@mokup/runtime'
import { createContract, diffOpenApiResponse, generateContractSource, generateOpenApiFixtures, importOpenApi, validateOpenApiParameters, validateOpenApiResponse } from '@mokup/runtime/contract'
import { loadContractDocument } from './contract-loader'

export interface ContractCheckOptions {
  contract: string
  fixtures?: string
  json?: boolean
  allowNetwork?: boolean
}

export interface ContractDiffOptions {
  contract: string
  expected: string
  actual: string
  maxDifferences?: number
  json?: boolean
  allowNetwork?: boolean
}

export interface ContractDiffReport {
  schemaVersion: 1
  valid: boolean
  operation?: { method: string, path: string }
  expected?: { valid: boolean, issues: Array<{ path: string, keyword: string, message: string }> }
  actual?: { valid: boolean, issues: Array<{ path: string, keyword: string, message: string }> }
  differences?: ReturnType<typeof diffOpenApiResponse>['differences']
  truncated?: boolean
  error?: { message: string }
}

interface ResponseSample {
  method: string
  path: string
  status: number
  contentType: string
  body: unknown
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function decodeSampleBody(value: unknown, contentType: string): unknown {
  if (value === null || value === undefined) {
    return null
  }
  const bytes = typeof value === 'object' && value !== null && !Array.isArray(value) && 'encoding' in value && 'data' in value
    ? Buffer.from(String((value as Record<string, unknown>)['data']), 'base64')
    : undefined
  if (!bytes) {
    return value
  }
  if (!bytes.length) {
    return null
  }
  const text = bytes.toString('utf8')
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (mime === 'application/json' || mime.endsWith('+json')) {
    try {
      return JSON.parse(text) as unknown
    }
    catch {
      return text
    }
  }
  return text
}

function readResponseSample(value: unknown): ResponseSample {
  const source = object(value)
  const recorded = object(source['response'])
  const request = object(source['request'])
  if (Object.keys(recorded).length > 0 && typeof request['method'] === 'string' && typeof request['url'] === 'string') {
    if (!Number.isInteger(recorded['status'])) {
      throw new TypeError('Recorded response fixture requires an integer response.status.')
    }
    const headers = new Headers(recorded['headers'] as HeadersInit)
    const url = new URL(request['url'] as string)
    const contentType = headers.get('content-type') ?? 'application/json'
    return {
      method: (request['method'] as string).toUpperCase(),
      path: `${url.pathname}${url.search}`,
      status: Number(recorded['status']),
      contentType,
      body: decodeSampleBody(recorded['body'], contentType),
    }
  }
  if (typeof source['method'] !== 'string' || typeof source['path'] !== 'string' || !Number.isInteger(source['status'])) {
    throw new TypeError('Response fixture requires method, path, and integer status.')
  }
  const headers = new Headers(source['headers'] as HeadersInit)
  const contentType = headers.get('content-type') ?? 'application/json'
  return {
    method: (source['method'] as string).toUpperCase(),
    path: source['path'] as string,
    status: Number(source['status']),
    contentType,
    body: decodeSampleBody(source['body'], contentType),
  }
}

function findOperation(operations: ReturnType<typeof importOpenApi>, sample: ResponseSample) {
  const url = new URL(sample.path, 'http://mokup.local')
  return operations.find(operation => operation.method === sample.method
    && matchRouteTokens(parseRouteTemplate(operation.path.replace(/:([^/]+)/gu, '[$1]')).tokens, url.pathname))
}

/** Compare two response fixtures using an OpenAPI response schema. */
export async function diffContractFiles(options: ContractDiffOptions): Promise<ContractDiffReport> {
  try {
    const document = await loadContractDocument(options.contract, options.allowNetwork === undefined ? {} : { allowNetwork: options.allowNetwork })
    const operations = importOpenApi(document)
    const expected = readResponseSample(JSON.parse(await readFile(options.expected, 'utf8')))
    const actual = readResponseSample(JSON.parse(await readFile(options.actual, 'utf8')))
    const operation = findOperation(operations, expected)
    if (!operation) {
      return { schemaVersion: 1, valid: false, error: { message: `No contract for ${expected.method} ${expected.path}` } }
    }
    if (actual.method !== expected.method || new URL(actual.path, 'http://mokup.local').pathname !== new URL(expected.path, 'http://mokup.local').pathname
      || actual.status !== expected.status || actual.contentType.split(';')[0] !== expected.contentType.split(';')[0]) {
      return { schemaVersion: 1, valid: false, operation: { method: operation.method, path: operation.path }, error: { message: 'Expected and actual fixtures describe different response routes, statuses, or media types.' } }
    }
    const result = diffOpenApiResponse(operation, expected.status, expected.contentType, expected.body, actual.body, options.maxDifferences === undefined ? {} : { maxDifferences: options.maxDifferences })
    return {
      schemaVersion: 1,
      valid: result.equal,
      operation: { method: operation.method, path: operation.path },
      expected: result.expected,
      actual: result.actual,
      differences: result.differences,
      truncated: result.truncated,
    }
  }
  catch (error) {
    return { schemaVersion: 1, valid: false, error: { message: error instanceof Error ? error.message : String(error) } }
  }
}

export async function runContractDiff(options: ContractDiffOptions): Promise<void> {
  const report = await diffContractFiles(options)
  process.exitCode = report.valid ? 0 : 1
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`)
    return
  }
  const lines = [`Mokup contract diff ${report.valid ? 'passed' : 'failed'}.`]
  if (report.operation) {
    lines.push(`Operation: ${report.operation.method} ${report.operation.path}`)
  }
  if (report.error) {
    lines.push(`Error: ${report.error.message}`)
  }
  for (const difference of report.differences ?? []) {
    const side = difference.side ? ` (${difference.side})` : ''
    const detail = difference.kind === 'invalid' ? `${difference.keyword ?? 'schema'}: ${difference.message ?? 'invalid response'}` : `${JSON.stringify(difference.expected)} -> ${JSON.stringify(difference.actual)}`
    lines.push(`${difference.kind}${side} ${difference.path}: ${detail}`)
  }
  if (report.truncated) {
    lines.push('Additional differences were truncated.')
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

/** Read JSON or YAML and resolve local/external references before validation. */
export async function checkContractFile(options: ContractCheckOptions) {
  const document = await loadContractDocument(options.contract, options.allowNetwork === undefined ? {} : { allowNetwork: options.allowNetwork })
  const operations = importOpenApi(document)
  for (const operation of operations) {
    if (operation.requestBody !== undefined) {
      createContract(operation.requestBody)
    }
    for (const content of Object.values(operation.responses)) {
      for (const schema of Object.values(content)) {
        createContract(schema)
      }
    }
  }
  const failures: Array<{ index: number, message: string }> = []
  let count = 0
  if (options.fixtures) {
    const fixtures: unknown = JSON.parse(await readFile(options.fixtures, 'utf8'))
    if (!Array.isArray(fixtures)) {
      throw new TypeError('Contract fixtures must be a JSON array of method/path/status/headers/body records; requestHeaders is optional for request validation.')
    }
    count = fixtures.length
    for (const [index, input] of fixtures.entries()) {
      if (!input || typeof input !== 'object' || typeof input.method !== 'string' || typeof input.path !== 'string' || !Number.isInteger(input.status)) {
        failures.push({ index, message: 'Fixture requires method, path, and integer status.' })
        continue
      }
      let fixtureUrl: URL
      try {
        fixtureUrl = new URL(input.path, 'http://mokup.local')
      }
      catch (error) {
        failures.push({ index, message: `Fixture path is invalid: ${error instanceof Error ? error.message : String(error)}` })
        continue
      }
      const operation = operations.find(operation => operation.method === input.method.toUpperCase()
        && matchRouteTokens(parseRouteTemplate(operation.path.replace(/:([^/]+)/g, '[$1]')).tokens, fixtureUrl.pathname))
      if (!operation) {
        failures.push({ index, message: `No contract for ${input.method} ${input.path}` })
        continue
      }
      let requestHeaders: Headers
      try {
        requestHeaders = new Headers((input.requestHeaders ?? input.headers) as HeadersInit)
      }
      catch (error) {
        failures.push({ index, message: `request headers: ${error instanceof Error ? error.message : String(error)}` })
        continue
      }
      let request: Request
      try {
        request = new Request(fixtureUrl, {
          method: input.method.toUpperCase(),
          headers: requestHeaders,
        })
      }
      catch (error) {
        failures.push({ index, message: `request: ${error instanceof Error ? error.message : String(error)}` })
        continue
      }
      const parameterValidation = validateOpenApiParameters(operation, request)
      failures.push(...parameterValidation.issues.map(issue => ({ index, message: `request ${issue.path}: ${issue.message}` })))
      if ('requestBody' in input && operation.requestBody !== undefined) {
        const validation = createContract(operation.requestBody).validate(input.requestBody)
        failures.push(...validation.issues.map(issue => ({ index, message: `request ${issue.path}: ${issue.message}` })))
      }
      else if (operation.requestRequired) {
        failures.push({ index, message: 'Required requestBody is missing.' })
      }
      let responseHeaders: Headers
      try {
        responseHeaders = new Headers(input.headers as HeadersInit)
      }
      catch (error) {
        failures.push({ index, message: `response headers: ${error instanceof Error ? error.message : String(error)}` })
        continue
      }
      const validation = validateOpenApiResponse(operation, input.status, responseHeaders.get('content-type') ?? 'application/json', input.body)
      failures.push(...validation.issues.map(issue => ({ index, message: `response ${issue.path}: ${issue.message}` })))
    }
  }
  return { schemaVersion: 1, valid: failures.length === 0, operationCount: operations.length, fixtureCount: count, failures }
}

export async function runContractCheck(options: ContractCheckOptions): Promise<void> {
  try {
    const report = await checkContractFile(options)
    process.exitCode = report.valid ? 0 : 1
    process.stdout.write(`${options.json
      ? JSON.stringify(report)
      : [
          `Mokup contract check ${report.valid ? 'passed' : 'failed'}: ${report.operationCount} operations, ${report.fixtureCount} fixtures.`,
          ...report.failures.map(failure => `Fixture ${failure.index}: ${failure.message}`),
        ].join('\n')}\n`)
  }
  catch (error) {
    process.exitCode = 1
    const message = error instanceof Error ? error.message : String(error)
    process.stdout.write(`${options.json ? JSON.stringify({ schemaVersion: 1, valid: false, error: { message } }) : `Mokup contract check failed: ${message}`}\n`)
  }
}

export function registerGenerateCommand(program: Command): void {
  program.command('generate')
    .description('Generate validated JSON response fixtures from OpenAPI 3.0/3.1 JSON or YAML')
    .requiredOption('--contract <file>', 'OpenAPI JSON or YAML document')
    .requiredOption('--out <file>', 'New fixture JSON file (never overwrites an existing file)')
    .option('--format <format>', 'Output format: json or typescript', 'json')
    .option('--allow-network', 'Allow HTTP(S) external contract references')
    .action(async (options: { contract: string, out: string, format: string, allowNetwork?: boolean }) => {
      const document = await loadContractDocument(options.contract, options.allowNetwork === undefined ? {} : { allowNetwork: options.allowNetwork })
      if (options.format !== 'json' && options.format !== 'typescript') {
        throw new TypeError('Contract output format must be json or typescript.')
      }
      const source = options.format === 'typescript'
        ? generateContractSource(document)
        : `${JSON.stringify(generateOpenApiFixtures(document), null, 2)}\n`
      await writeFile(options.out, source, { flag: 'wx' })
    })
}

export function registerDiffCommand(program: Command): void {
  program.command('diff')
    .description('Compare response fixtures against an OpenAPI response contract')
    .requiredOption('--contract <file>', 'OpenAPI JSON or YAML document')
    .requiredOption('--expected <file>', 'Expected response fixture JSON')
    .requiredOption('--actual <file>', 'Actual response fixture JSON')
    .option('--max-differences <count>', 'Maximum differences to report', value => Number(value))
    .option('--allow-network', 'Allow HTTP(S) external contract references')
    .option('--json', 'Print a JSON report')
    .action(async (options: Omit<ContractDiffOptions, 'contract' | 'expected' | 'actual'> & { contract: string, expected: string, actual: string }) => {
      await runContractDiff(options)
    })
}
