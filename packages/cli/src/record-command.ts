import type { RecordingFetch, RecordingFetchOptions } from '@mokup/runtime/recording'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname } from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createRecordingFetch } from '@mokup/runtime/recording'
import { collectValues } from './command-options'

export interface RecordCommandOptions extends RecordingFetchOptions {
  target: string
  out: string
  host?: string
  port?: string
  duration?: string
  redactQuery?: string[]
}

export interface RecordingProxy {
  server: Server
  recorder: RecordingFetch
  close: () => Promise<void>
}

async function readIncomingBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    request.resume()
    return undefined
  }
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (name === 'host' || name === 'connection' || value === undefined) {
      continue
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, item)
    }
  }
  return headers
}

async function writeResponse(response: ServerResponse, upstream: Response): Promise<void> {
  upstream.headers.forEach((value, name) => {
    if (name !== 'set-cookie' && name !== 'connection' && name !== 'transfer-encoding') {
      response.setHeader(name, value)
    }
  })
  const cookies = upstream.headers.getSetCookie()
  if (cookies.length) {
    response.setHeader('set-cookie', cookies)
  }
  response.statusCode = upstream.status
  if (upstream.statusText) {
    response.statusMessage = upstream.statusText
  }
  if (!upstream.body) {
    response.end()
    return
  }
  await pipeline(Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>), response)
}

/** Create a finite HTTP forward proxy that records redacted request/response fixtures. */
export function createRecordingProxy(options: RecordCommandOptions): RecordingProxy {
  const target = new URL(options.target)
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new TypeError('Recording target must use HTTP or HTTPS.')
  }
  const recordingOptions: RecordingFetchOptions = {
    ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
    ...(options.bodyTimeoutMs === undefined ? {} : { bodyTimeoutMs: options.bodyTimeoutMs }),
    ...(options.redact === undefined && options.redactQuery === undefined
      ? {}
      : {
          redact: {
            ...(options.redact ?? {}),
            ...(options.redactQuery === undefined ? {} : { query: options.redactQuery }),
          },
        }),
  }
  const recorder = createRecordingFetch(request => fetch(request), recordingOptions)
  const server = createServer(async (request, response) => {
    try {
      const incoming = new URL(request.url ?? '/', 'http://mokup-record.local')
      const destination = new URL(`${incoming.pathname}${incoming.search}`, target)
      const body = await readIncomingBody(request)
      const upstream = await recorder.fetch(new Request(destination, {
        method: request.method ?? 'GET',
        headers: requestHeaders(request),
        ...(body === undefined ? {} : { body: body as unknown as BodyInit }),
      }))
      await writeResponse(response, upstream)
    }
    catch {
      if (!response.headersSent) {
        response.statusCode = 502
        response.end('Bad Gateway')
      }
      else {
        response.destroy()
      }
    }
  })
  const close = async () => {
    await recorder.flush()
    await new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve()
        return
      }
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
  }
  return { server, recorder, close }
}

export function registerRecordCommand(program: import('commander').Command): void {
  program.command('record')
    .description('Forward HTTP requests to a real API and save redacted fixtures')
    .requiredOption('--target <url>', 'Upstream HTTP(S) origin')
    .requiredOption('--out <file>', 'Fixture JSON output path')
    .option('--host <host>', 'Proxy hostname', '127.0.0.1')
    .option('--port <port>', 'Proxy port', '0')
    .option('--duration <ms>', 'Stop automatically after this many milliseconds')
    .option('--max-body-bytes <bytes>', 'Maximum captured body size', value => Number(value))
    .option('--body-timeout-ms <ms>', 'Maximum capture time per body', value => Number(value))
    .option('--redact-query <name>', 'Query parameter to redact (repeatable)', collectValues)
    .action(async (options: RecordCommandOptions) => {
      const proxy = createRecordingProxy(options)
      const host = options.host ?? '127.0.0.1'
      const port = Number(options.port ?? 0)
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new TypeError(`Invalid port: ${options.port}`)
      }
      let closing: Promise<void> | undefined
      const stop = async () => {
        closing ??= (async () => {
          await proxy.close()
          await mkdir(dirname(options.out), { recursive: true })
          await writeFile(options.out, `${JSON.stringify(proxy.recorder.fixtures(), null, 2)}\n`, { flag: 'w' })
        })()
        await closing
      }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
      await new Promise<void>((resolve, reject) => {
        proxy.server.once('error', reject)
        proxy.server.listen(port, host, () => {
          const address = proxy.server.address()
          const actualPort = typeof address === 'object' && address ? address.port : port
          process.stdout.write(`Mokup recorder listening at http://${host}:${actualPort}\n`)
          if (options.duration !== undefined) {
            const duration = Number(options.duration)
            if (!Number.isFinite(duration) || duration < 0) {
              reject(new TypeError(`Invalid duration: ${options.duration}`))
              return
            }
            setTimeout(() => {
              void stop().then(resolve, reject)
            }, duration).unref()
          }
        })
      })
      if (options.duration !== undefined) {
        await closing
      }
    })
}
