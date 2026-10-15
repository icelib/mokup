import { Buffer } from 'node:buffer'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createRuntime, parseRouteTemplate } from '../src/index'

async function createTempModule(source: string) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'mokup-runtime-'))
  const handlerPath = path.join(root, 'handler.mjs')
  await fs.writeFile(handlerPath, source, 'utf8')
  return { root, moduleBase: new URL(`file://${root}/`) }
}

const handlerSource = [
  'export const rules = [',
  '  { handler: { step: "first" } },',
  '  { handler: { step: "second" } },',
  ']',
  '',
  'export const objectRule = {',
  '  handler: { step: "object" },',
  '}',
  '',
  'export const stringHandler = () => "hello"',
  '',
  'export const bufferHandler = () => new Uint8Array([1, 2, 3]).buffer',
  '',
  'export const responseHandler = () => new Response("created", { status: 202 })',
  '',
  'export const undefinedHandler = (c) => {',
  '  c.status(404)',
  '  return undefined',
  '}',
  '',
  'export const middlewares = [',
  '  async (c, next) => {',
  '    await next()',
  '    c.header("x-mw", "1")',
  '  },',
  '  "skip",',
  ']',
  '',
  'export default function handler(c) {',
  '  c.status(201)',
  '  c.header("x-rule", "handler")',
  '  c.header("x-temp", "remove")',
  '  c.res.headers.delete("x-temp")',
  '  return {',
  '    ok: true,',
  '    params: c.req.param(),',
  '    query: c.req.query(),',
  '  }',
  '}',
  '',
].join('\n')

function createRequest(pathname: string, method = 'GET') {
  return {
    method,
    path: pathname,
    query: { foo: 'bar' },
    headers: {},
    body: undefined,
  }
}

describe('runtime handling', () => {
  it('maps HEAD requests to GET routes', async () => {
    const runtime = createRuntime({
      manifest: {
        version: 1,
        routes: [
          {
            method: 'GET',
            url: '/head',
            response: { type: 'text', body: 'ok' },
          },
        ],
      },
    })

    const headResult = await runtime.handle(createRequest('/head', 'HEAD'))
    expect(headResult?.status).toBe(200)
  })

  it('serves json, text, binary, and empty bodies', async () => {
    const runtime = createRuntime({
      manifest: {
        version: 1,
        routes: [
          {
            method: 'GET',
            url: '/json',
            response: { type: 'json', body: { ok: true } },
          },
          {
            method: 'GET',
            url: '/text',
            response: { type: 'text', body: 'hello' },
          },
          {
            method: 'GET',
            url: '/binary',
            response: {
              type: 'binary',
              body: Buffer.from('hello').toString('base64'),
              encoding: 'base64',
            },
          },
          {
            method: 'GET',
            url: '/empty',
            response: { type: 'json', body: undefined },
          },
        ],
      },
    })

    const jsonResult = await runtime.handle(createRequest('/json?foo=1#hash'))
    const jsonBody = jsonResult?.body ? JSON.parse(String(jsonResult.body)) : null
    expect(jsonResult?.status).toBe(200)
    expect(jsonResult?.headers['content-type']).toContain('application/json')
    expect(jsonBody).toEqual({ ok: true })

    const textResult = await runtime.handle(createRequest('/text'))
    expect(textResult?.body).toBe('hello')
    expect(textResult?.headers['content-type']).toContain('text/plain')

    const binaryResult = await runtime.handle(createRequest('/binary'))
    expect(binaryResult?.headers['content-type']).toBe('application/octet-stream')
    expect(binaryResult?.body).toBeInstanceOf(Uint8Array)
    expect(Array.from(binaryResult?.body ?? [])).toEqual([104, 101, 108, 108, 111])

    const emptyResult = await runtime.handle(createRequest('/empty'))
    expect(emptyResult?.status).toBe(204)
    expect(emptyResult?.body).toBeNull()
  })

  it('executes module handlers and resolves exportName/ruleIndex', async () => {
    const { moduleBase } = await createTempModule(handlerSource)
    const runtime = createRuntime({
      manifest: {
        version: 1,
        routes: [
          {
            method: 'GET',
            url: '/module/[id]',
            headers: { 'content-type': 'application/custom' },
            response: {
              type: 'module',
              module: './handler.mjs',
            },
          },
          {
            method: 'GET',
            url: '/module/object',
            response: {
              type: 'module',
              module: './handler.mjs',
              exportName: 'objectRule',
            },
          },
          {
            method: 'GET',
            url: '/module/rules',
            response: {
              type: 'module',
              module: './handler.mjs',
              exportName: 'rules',
              ruleIndex: 1,
            },
          },
          {
            method: 'GET',
            url: '/module/buffer',
            response: {
              type: 'module',
              module: './handler.mjs',
              exportName: 'bufferHandler',
            },
          },
        ],
      },
      moduleBase,
    })

    const defaultResult = await runtime.handle(createRequest('/module/42'))
    expect(defaultResult?.body).toBeInstanceOf(Uint8Array)
    const defaultBody = JSON.parse(new TextDecoder().decode(defaultResult?.body as Uint8Array))
    expect(defaultResult?.status).toBe(201)
    expect(defaultResult?.headers['content-type']).toBe('application/custom')
    expect(defaultResult?.headers['x-rule']).toBe('handler')
    expect(defaultResult?.headers['x-temp']).toBeUndefined()
    expect(defaultBody).toEqual({
      ok: true,
      params: { id: '42' },
      query: { foo: 'bar' },
    })

    const objectResult = await runtime.handle(createRequest('/module/object'))
    const objectBody = objectResult?.body ? JSON.parse(String(objectResult.body)) : null
    expect(objectBody).toEqual({ step: 'object' })
    expect(objectResult?.headers['content-type']).toContain('application/json')

    const rulesResult = await runtime.handle(createRequest('/module/rules'))
    const rulesBody = rulesResult?.body ? JSON.parse(String(rulesResult.body)) : null
    expect(rulesBody).toEqual({ step: 'second' })

    const bufferResult = await runtime.handle(createRequest('/module/buffer'))
    expect(bufferResult?.headers['content-type']).toBe('application/octet-stream')
    expect(Array.from(bufferResult?.body ?? [])).toEqual([1, 2, 3])
  })

  it('applies module middlewares, delay, and string handlers', async () => {
    vi.useFakeTimers()
    const { moduleBase } = await createTempModule(handlerSource)
    const runtime = createRuntime({
      manifest: {
        version: 1,
        routes: [
          {
            method: 'GET',
            url: '/module/string',
            response: {
              type: 'module',
              module: './handler.mjs',
              exportName: 'stringHandler',
            },
          },
          {
            method: 'GET',
            url: '/module/mw',
            delay: 10,
            middleware: [
              {
                module: './handler.mjs',
                exportName: 'middlewares',
                ruleIndex: 0,
              },
            ],
            response: { type: 'json', body: { ok: true } },
          },
        ],
      },
      moduleBase,
    })

    const stringResult = await runtime.handle(createRequest('/module/string'))
    expect(stringResult?.body).toBe('hello')

    const mwPromise = runtime.handle(createRequest('/module/mw'))
    await vi.runAllTimersAsync()
    const mwResult = await mwPromise
    expect(mwResult?.headers['x-mw']).toBe('1')
    vi.useRealTimers()
  })

  it('handles response and undefined module handlers', async () => {
    const { moduleBase } = await createTempModule(handlerSource)
    const runtime = createRuntime({
      manifest: {
        version: 1,
        routes: [
          {
            method: 'GET',
            url: '/module/response',
            response: {
              type: 'module',
              module: './handler.mjs',
              exportName: 'responseHandler',
            },
          },
          {
            method: 'GET',
            url: '/module/undefined',
            response: {
              type: 'module',
              module: './handler.mjs',
              exportName: 'undefinedHandler',
            },
          },
        ],
      },
      moduleBase,
    })

    const responseResult = await runtime.handle(createRequest('/module/response'))
    expect(responseResult?.status).toBe(202)
    expect(responseResult?.body).toBe('created')

    const undefinedResult = await runtime.handle(createRequest('/module/undefined'))
    expect(undefinedResult?.status).toBe(404)
    expect(undefinedResult?.body).toBeNull()
  })

  it('uses module maps with async manifests', async () => {
    const runtime = createRuntime({
      manifest: async () => ({
        version: 1,
        routes: [
          {
            method: 'GET',
            url: '/mapped',
            response: { type: 'module', module: 'mock:handler' },
          },
        ],
      }),
      moduleMap: {
        'mock:handler': { default: () => 'ok' },
      },
    })

    const result = await runtime.handle(createRequest('/mapped'))
    expect(result?.body).toBe('ok')
  })

  it('skips invalid routes and falls back to GET', async () => {
    const runtime = createRuntime({
      manifest: {
        version: 1,
        routes: [
          {
            method: 'GET',
            url: '/(admin)/users',
            response: { type: 'json', body: { skip: true } },
          },
          {
            method: 'GET',
            url: '/fallback',
            response: { type: 'text', body: 'ok' },
          },
        ],
      },
    })

    const fallback = await runtime.handle(createRequest('/fallback', 'UNKNOWN'))
    expect(fallback?.body).toBe('ok')

    const skipped = await runtime.handle(createRequest('/(admin)/users'))
    expect(skipped).toBeNull()
  })

  it('returns null when no method matches', async () => {
    const runtime = createRuntime({
      manifest: {
        version: 1,
        routes: [
          { method: 'GET', url: '/only-get', response: { type: 'text', body: 'ok' } },
        ],
      },
    })

    const result = await runtime.handle(createRequest('/only-get', 'POST'))
    expect(result).toBeNull()
  })

  it('throws when moduleBase is missing for relative modules', async () => {
    const runtime = createRuntime({
      manifest: {
        version: 1,
        routes: [
          {
            method: 'GET',
            url: '/module',
            response: { type: 'module', module: './handler.mjs' },
          },
        ],
      },
    })

    await expect(runtime.handle(createRequest('/module'))).rejects.toThrow(
      'moduleBase is required',
    )
  })

  it('accepts precomputed route tokens', async () => {
    const parsed = parseRouteTemplate('/tokens/[id]')
    const runtime = createRuntime({
      manifest: {
        version: 1,
        routes: [
          {
            method: 'GET',
            url: parsed.template,
            tokens: parsed.tokens,
            response: { type: 'json', body: { ok: true } },
          },
        ],
      },
    })

    const result = await runtime.handle(createRequest('/tokens/123'))
    const body = result?.body ? JSON.parse(String(result.body)) : null
    expect(body).toEqual({ ok: true })
  })
})
