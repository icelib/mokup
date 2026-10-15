// @vitest-environment node

import type { BuildCurlOptions } from '../src/utils/curl'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { buildCurl } from '../src/utils/curl'
import { buildFetch } from '../src/utils/fetch'

interface CapturedRequest {
  method: string
  path: string
  headers: Headers
  body: string
}

type CaptureRequest = (options: BuildCurlOptions) => Promise<CapturedRequest>

const executeFile = promisify(execFile)

function requestOptions(overrides: Partial<BuildCurlOptions> = {}): BuildCurlOptions {
  return {
    method: 'POST',
    url: 'http://localhost/echo',
    headers: {},
    bodyType: 'none',
    rawType: 'text',
    bodyText: '',
    authType: 'none',
    authToken: '',
    authUsername: '',
    authPassword: '',
    authKeyName: '',
    authKeyValue: '',
    authKeyLocation: 'header',
    authCustomName: '',
    authCustomValue: '',
    ...overrides,
  }
}

async function captureFetch(options: BuildCurlOptions): Promise<CapturedRequest> {
  const capture = (input: RequestInfo | URL, init?: RequestInit) => new Request(input, init)
  // Evaluate the complete copyable expression with native Request/FormData semantics.
  // eslint-disable-next-line no-new-func
  const evaluate = new Function('fetch', 'FormData', `return (${buildFetch(options)})`) as (
    fetch: typeof capture,
    formData: typeof FormData,
  ) => Request
  const request = evaluate(capture, FormData)
  const url = new URL(request.url)
  return {
    method: request.method,
    path: url.pathname + url.search,
    headers: request.headers,
    body: await request.text(),
  }
}

async function captureCurl(options: BuildCurlOptions): Promise<CapturedRequest> {
  const requests: CapturedRequest[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('error', () => response.destroy())
    request.on('end', () => {
      const headers = new Headers()
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) {
          value.forEach(item => headers.append(name, item))
        }
        else if (value !== undefined) {
          headers.set(name, value)
        }
      }
      requests.push({
        method: request.method ?? '',
        path: request.url ?? '',
        headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      response.end('ok')
    })
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected an owned TCP listener')
    }
    const url = new URL(options.url)
    url.protocol = 'http:'
    url.host = `127.0.0.1:${address.port}`
    await executeFile('/bin/sh', ['-c', buildCurl({ ...options, url: url.toString() })], {
      timeout: 3000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, NO_PROXY: '*', no_proxy: '*' },
    })
    expect(requests).toHaveLength(1)
    const request = requests[0]
    if (!request) {
      throw new Error('The copied cURL command did not send a request')
    }
    return request
  }
  finally {
    server.closeAllConnections()
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    }
  }
}

async function withLiteralFile(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'mokup-request-copy-'))
  try {
    const path = join(directory, 'literal \' file.txt')
    await writeFile(path, 'Owned fixture: these file bytes must never become the request body.')
    await run(path)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function requestCopyContract(capture: CaptureRequest) {
  it('preserves query separators and literal URL brackets', async () => {
    const path = '/echo/[item]?tag[]=one&tag[]=two'
    const request = await capture(requestOptions({ method: 'get', url: `http://localhost${path}` }))
    expect(request.method).toBe('GET')
    expect(request.path).toBe(path)
  })

  it('preserves raw whitespace, newlines, quotes, and backslashes', async () => {
    const bodyText = ' \n\'single\' "double" \\ backslash\r\n@literal\n \t'
    const request = await capture(requestOptions({ bodyType: 'raw', bodyText }))
    expect(request.body).toBe(bodyText)
    expect(request.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  })

  it('sends a raw @file path as literal text', async () => {
    await withLiteralFile(async (path) => {
      const bodyText = `@${path}`
      const request = await capture(requestOptions({ bodyType: 'raw', bodyText }))
      expect(request.body).toBe(bodyText)
    })
  })

  it('encodes newline and ampersand separated form fields without dropping duplicates', async () => {
    const request = await capture(requestOptions({
      bodyType: 'form-urlencoded',
      bodyText: 'tag=first&tag=second\r\nnote=a=b\nempty=\nspaced=two words',
    }))
    expect(Array.from(new URLSearchParams(request.body))).toEqual([
      ['tag', 'first'],
      ['tag', 'second'],
      ['note', 'a=b'],
      ['empty', ''],
      ['spaced', 'two words'],
    ])
    expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded; charset=utf-8')
  })

  it('sends multipart @file and ;type values as text fields', async () => {
    await withLiteralFile(async (path) => {
      const upload = `@${path};type=text/plain`
      const request = await capture(requestOptions({
        bodyType: 'form-data',
        bodyText: `upload=${upload}\nnote=plain;type=text/html&tag=one&tag=two`,
      }))
      expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/)
      const form = await new Response(request.body, { headers: request.headers }).formData()
      expect(Array.from(form.entries())).toEqual([
        ['upload', upload],
        ['note', 'plain;type=text/html'],
        ['tag', 'one'],
        ['tag', 'two'],
      ])
      expect(Array.from(form.values()).every(value => typeof value === 'string')).toBe(true)
    })
  })

  it('preserves JSON as raw data including an own __proto__ key', async () => {
    const bodyText = ' { "__proto__": { "copyRequestPolluted": true }, "quote": "it\'s raw" }\n'
    const request = await capture(requestOptions({ bodyType: 'raw', rawType: 'json', bodyText }))
    expect(request.body).toBe(bodyText)
    expect(Object.hasOwn(JSON.parse(request.body), '__proto__')).toBe(true)
    expect(request.headers.get('content-type')).toBe('application/json; charset=utf-8')
  })

  it.each([
    { method: 'get', bodyType: 'raw' },
    { method: 'get', bodyType: 'form-urlencoded' },
    { method: 'get', bodyType: 'form-data' },
    { method: 'head', bodyType: 'raw' },
    { method: 'head', bodyType: 'form-urlencoded' },
    { method: 'head', bodyType: 'form-data' },
  ] as const)('omits the $bodyType body for $method', async ({ method, bodyType }) => {
    const request = await capture(requestOptions({ method, bodyType, bodyText: 'field=value' }))
    expect(request.method).toBe(method.toUpperCase())
    expect(request.body).toBe('')
    expect(request.headers.has('content-type')).toBe(false)
  })

  it('omits whitespace-only raw bodies and their default content type', async () => {
    const request = await capture(requestOptions({ bodyType: 'raw', bodyText: ' \r\n\t ' }))
    expect(request.body).toBe('')
    expect(request.headers.has('content-type')).toBe(false)
  })

  it('respects lowercase Content-Type and sends explicit empty headers', async () => {
    const request = await capture(requestOptions({
      headers: { 'content-type': 'application/custom', 'x-empty': '', 'x-spaces': ' \t' },
      bodyType: 'raw',
      bodyText: 'custom body',
    }))
    expect(request.body).toBe('custom body')
    expect(request.headers.get('content-type')).toBe('application/custom')
    for (const name of ['x-empty', 'x-spaces']) {
      expect(request.headers.has(name)).toBe(true)
      expect(request.headers.get(name)).toBe('')
    }
  })

  it.each([
    {
      name: 'bearer',
      options: { authType: 'bearer', authToken: 'new-token' },
      header: 'Authorization',
      expected: 'Bearer new-token',
    },
    {
      name: 'basic',
      options: { authType: 'basic', authUsername: 'user', authPassword: 'pass' },
      header: 'Authorization',
      expected: 'Basic dXNlcjpwYXNz',
    },
    {
      name: 'API key',
      options: { authType: 'apikey', authKeyName: 'X-Api-Key', authKeyValue: 'new-key' },
      header: 'X-Api-Key',
      expected: 'new-key',
    },
    {
      name: 'custom',
      options: { authType: 'custom', authCustomName: 'X-Custom', authCustomValue: 'new-custom' },
      header: 'X-Custom',
      expected: 'new-custom',
    },
  ] as const)('lets $name auth replace the exact same header key', async ({ options, header, expected }) => {
    const request = await capture(requestOptions({ ...options, headers: { [header]: 'previous-value' } }))
    expect(request.headers.get(header)).toBe(expected)
  })

  it('encodes query API keys while retaining unrelated repeated parameters', async () => {
    const request = await capture(requestOptions({
      url: 'http://localhost/echo?tag=one&tag=two&key=previous',
      authType: 'apikey',
      authKeyLocation: 'query',
      authKeyName: 'key',
      authKeyValue: 'secret & [] \' value',
    }))
    const url = new URL(request.path, 'http://localhost')
    expect(url.searchParams.getAll('tag')).toEqual(['one', 'two'])
    expect(url.searchParams.getAll('key')).toEqual(['secret & [] \' value'])
  })
}

describe('copied Fetch expression', () => {
  requestCopyContract(captureFetch)
})

describe.skipIf(process.platform === 'win32')('copied POSIX cURL command', () => {
  requestCopyContract(captureCurl)
})
