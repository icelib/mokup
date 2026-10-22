import type { RecordingRedaction } from '@mokup/runtime/recording'
import type { Command } from 'commander'
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { compareLive } from '@mokup/runtime/recording'
import { createFetchServer } from '@mokup/server/node'
import { collectValues } from './command-options'

export interface CompareRequestFile {
  method?: string | undefined
  url: string
  headers?: HeadersInit | undefined
  /** Text, or a `{ encoding: "base64", data }` body for binary requests. */
  body?: string | { encoding: 'base64', data: string } | null | undefined
}

export interface CompareCommandOptions {
  request: string
  real: string
  dir?: string[]
  root?: string
  prefix?: string
  out?: string
  json?: boolean
  maxBodyBytes?: number
  bodyTimeoutMs?: number
  maxDifferences?: number
  redactQuery?: string[]
  redactHeader?: string[]
  redactJsonPointer?: string[]
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseRequest(value: unknown): CompareRequestFile {
  const source = object(value)
  if (typeof source['url'] !== 'string' || !source['url']) {
    throw new TypeError('Compare request requires a nonempty url.')
  }
  const method = source['method'] === undefined ? 'GET' : source['method']
  if (typeof method !== 'string' || !/^[A-Za-z]+$/u.test(method)) {
    throw new TypeError('Compare request method must contain only ASCII letters.')
  }
  let headers: HeadersInit | undefined
  try {
    if (source['headers'] !== undefined) {
      headers = new Headers(source['headers'] as HeadersInit)
    }
  }
  catch (error) {
    throw new TypeError(`Compare request headers are invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  const body = source['body']
  if (body !== undefined && body !== null && typeof body !== 'string') {
    const encoded = object(body)
    if (encoded['encoding'] !== 'base64' || typeof encoded['data'] !== 'string') {
      throw new TypeError('Compare request body must be text or a base64 body object.')
    }
    try {
      atob(encoded['data'] as string)
    }
    catch (error) {
      throw new TypeError(`Compare request body is not valid base64: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    method: method.toUpperCase(),
    url: source['url'] as string,
    ...(headers === undefined ? {} : { headers }),
    ...(body === undefined ? {} : { body: body as CompareRequestFile['body'] }),
  }
}

function decodeBody(body: CompareRequestFile['body']): BodyInit | undefined {
  if (body === undefined || body === null) {
    return undefined
  }
  if (typeof body === 'string') {
    return body
  }
  const binary = atob(body.data)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return bytes
}

function createRequest(input: CompareRequestFile): Request {
  const body = decodeBody(input.body)
  return new Request(input.url, {
    method: input.method ?? 'GET',
    ...(input.headers === undefined ? {} : { headers: input.headers }),
    ...(body === undefined ? {} : { body }),
  })
}

function redaction(options: CompareCommandOptions): RecordingRedaction | undefined {
  if (!options.redactQuery?.length && !options.redactHeader?.length && !options.redactJsonPointer?.length) {
    return undefined
  }
  return {
    ...(options.redactQuery?.length ? { query: options.redactQuery } : {}),
    ...(options.redactHeader?.length ? { headers: options.redactHeader } : {}),
    ...(options.redactJsonPointer?.length ? { jsonPointers: options.redactJsonPointer } : {}),
  }
}

function realRequestUrl(real: string, source: Request): string {
  const target = new URL(real)
  if (target.pathname === '/' && !target.search && new URL(source.url).pathname !== '/') {
    const original = new URL(source.url)
    target.pathname = original.pathname
    target.search = original.search
  }
  return target.href
}

async function requestForReal(real: string, source: Request): Promise<Request> {
  const body = source.body ? new Uint8Array(await source.arrayBuffer()) : undefined
  return new Request(realRequestUrl(real, source), {
    method: source.method,
    headers: source.headers,
    ...(body === undefined ? {} : { body }),
    cache: source.cache,
    credentials: source.credentials,
    integrity: source.integrity,
    keepalive: source.keepalive,
    mode: source.mode,
    redirect: source.redirect,
    referrer: source.referrer,
    referrerPolicy: source.referrerPolicy,
  })
}

function printResult(result: Awaited<ReturnType<typeof compareLive>>): string {
  const status = result.equal ? 'passed' : 'failed'
  const lines = [`Mokup live comparison ${status}.`, `Request: ${result.request.method} ${result.request.url}`]
  if (result.mock.fixture && result.real.fixture) {
    lines.push(`Responses: ${result.mock.fixture.response.status} -> ${result.real.fixture.response.status}`)
    for (const difference of result.diff?.differences ?? []) {
      lines.push(`${difference.kind} ${difference.path}`)
    }
    for (const difference of result.contract?.differences ?? []) {
      lines.push(`contract ${difference.kind} ${difference.path}`)
    }
  }
  if (result.mock.error) {
    lines.push(`Mock error: ${result.mock.error.message}`)
  }
  if (result.real.error) {
    lines.push(`Real error: ${result.real.error.message}`)
  }
  return `${lines.join('\n')}\n`
}

export async function runCompare(options: CompareCommandOptions): Promise<Awaited<ReturnType<typeof compareLive>>> {
  const source = parseRequest(JSON.parse(await readFile(options.request, 'utf8')))
  const request = createRequest(source)
  const real = new URL(options.real)
  if (!['http:', 'https:'].includes(real.protocol)) {
    throw new TypeError('Compare real URL must use HTTP or HTTPS.')
  }
  const server = await createFetchServer({
    entries: {
      ...(options.dir?.length ? { dir: options.dir } : {}),
      ...(options.root === undefined ? {} : { root: options.root }),
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
      watch: false,
      log: false,
    },
    playground: false,
    onUnhandled: 'bypass',
  })
  try {
    const redactPolicy = redaction(options)
    return await compareLive(request, {
      mock: input => server.fetch(input),
      real: async input => fetch(await requestForReal(real.href, input)),
    }, {
      ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
      ...(options.bodyTimeoutMs === undefined ? {} : { bodyTimeoutMs: options.bodyTimeoutMs }),
      ...(options.maxDifferences === undefined ? {} : { maxDifferences: options.maxDifferences }),
      ...(redactPolicy === undefined ? {} : { redact: redactPolicy }),
    })
  }
  finally {
    await server.dispose()
  }
}

export function registerCompareCommand(program: Command): void {
  program.command('compare')
    .description('Compare a file mock response with a live HTTP API response')
    .requiredOption('--request <file>', 'JSON request file containing method, url, headers and optional body')
    .requiredOption('--real <url>', 'Live HTTP(S) URL; a root URL preserves the request path and query')
    .option('-d, --dir <dir>', 'Mock directory (repeatable)', collectValues)
    .option('--root <dir>', 'Project root (default: current directory)')
    .option('--prefix <prefix>', 'URL prefix for the mock routes')
    .option('--out <file>', 'Write the full comparison report to a JSON file')
    .option('--max-body-bytes <bytes>', 'Maximum captured body size', value => Number(value))
    .option('--body-timeout-ms <ms>', 'Maximum capture time per body', value => Number(value))
    .option('--max-differences <count>', 'Maximum differences to retain', value => Number(value))
    .option('--redact-query <name>', 'Query parameter to redact (repeatable)', collectValues)
    .option('--redact-header <name>', 'Additional header to redact (repeatable)', collectValues)
    .option('--redact-json-pointer <pointer>', 'JSON Pointer to redact in bodies (repeatable)', collectValues)
    .option('--json', 'Print the full comparison report as JSON')
    .action(async (options: CompareCommandOptions) => {
      try {
        const result = await runCompare(options)
        process.exitCode = result.equal ? 0 : 1
        if (options.out) {
          await writeFile(options.out, `${JSON.stringify(result, null, 2)}\n`, { flag: 'w' })
        }
        if (options.json || !options.out) {
          process.stdout.write(options.json ? `${JSON.stringify(result)}\n` : printResult(result))
        }
      }
      catch (error) {
        process.exitCode = 1
        const message = error instanceof Error ? error.message : String(error)
        process.stdout.write(options.json ? `${JSON.stringify({ schemaVersion: 1, equal: false, error: { message } })}\n` : `Mokup live comparison failed: ${message}\n`)
      }
    })
}
