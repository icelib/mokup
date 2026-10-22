import type { OpenApiParameter } from '../src/contract'
import { describe, expect, it, vi } from 'vitest'
import { createContractHandler, importOpenApi } from '../src/contract'
import { createMockSession } from '../src/http'

function specification(parameters: unknown[], pathParameters: unknown[] = [], path = '/users/{id}') {
  return {
    openapi: '3.1.0',
    paths: { [path]: { parameters: pathParameters, get: { parameters, responses: { 200: { content: { 'application/json': { schema: true } } } } } } },
  }
}

const id: OpenApiParameter = { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }

describe('OpenAPI parameter import and HTTP validation', () => {
  it('parses query/header/path/cookie parameters while preserving the original context', async () => {
    const [operation] = importOpenApi(specification([
      id,
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 2 } },
      { name: 'active', in: 'query', schema: { type: 'boolean', default: false } },
      { name: 'tags', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
      { name: 'ids', in: 'query', explode: false, schema: { type: 'array', items: { type: 'integer' } } },
      { name: 'X-Roles', in: 'header', schema: { type: 'array', items: { type: 'string', enum: ['admin', 'reader'] } } },
      { name: 'session', in: 'cookie', required: true, schema: { type: 'string', minLength: 1 } },
      { name: 'flags', in: 'cookie', explode: false, schema: { type: 'array', items: { type: 'boolean' } } },
    ]))
    const session = createMockSession(createContractHandler(operation!, ({ parameters, params, cookies, request }) => {
      expect(params['id']).toBe('7')
      expect(cookies['session']).toBe('s/a')
      expect(request.headers.get('x-roles')).toBe('admin, reader')
      return { status: 200, body: parameters }
    }))
    const response = await session.handle(new Request('https://params.test/users/7?tags=one&tags=two&ids=2,3', {
      headers: { 'X-Roles': 'admin, reader', 'Cookie': 'session=s%2Fa; flags=true,false' },
    }))
    expect(await response!.json()).toEqual({
      path: { id: 7 },
      query: { page: 2, active: false, tags: ['one', 'two'], ids: [2, 3] },
      header: { 'x-roles': ['admin', 'reader'] },
      cookie: { session: 's/a', flags: [true, false] },
    })
    await session.dispose()
  })

  it('preserves percent-encoded commas inside array items across query, path and cookie', async () => {
    const [operation] = importOpenApi(specification([
      { name: 'names', in: 'path', required: true, schema: { type: 'array', items: { type: 'string' } } },
      { name: 'names', in: 'query', explode: false, schema: { type: 'array', items: { type: 'string' } } },
      { name: 'names', in: 'cookie', explode: false, schema: { type: 'array', items: { type: 'string' } } },
    ], [], '/groups/{names}'))
    const session = createMockSession(createContractHandler(operation!, ({ parameters }) => ({ status: 200, body: parameters })))
    const response = await session.handle(new Request('https://params.test/groups/one%2Ctwo,three?names=one%2Ctwo,three', {
      headers: { cookie: 'names=one%2Ctwo,three' },
    }))
    expect(await response!.json()).toEqual({
      query: { names: ['one,two', 'three'] },
      path: { names: ['one,two', 'three'] },
      cookie: { names: ['one,two', 'three'] },
      header: {},
    })
    await session.dispose()
  })

  it.each([
    ['/users/0?count=2', {}, '/parameters/path/id'],
    ['/users/1?count=NaN', {}, '/parameters/query/count'],
    ['/users/1?count=2&count=3', {}, '/parameters/query/count'],
    ['/users/1?count=9007199254740993', {}, '/parameters/query/count'],
    ['/users/1?count=2&active=1', {}, '/parameters/query/active'],
    ['/users/1?count=2', { 'x-level': 'invalid' }, '/parameters/header/x-level'],
    ['/users/1', {}, '/parameters/query/count'],
  ] as const)('rejects invalid parameters for %s before invoking the resolver', async (path, headers, issuePath) => {
    const [operation] = importOpenApi(specification([
      id,
      { name: 'count', in: 'query', required: true, schema: { type: 'integer', minimum: 1, default: 10 } },
      { name: 'active', in: 'query', schema: { type: 'boolean' } },
      { name: 'x-level', in: 'header', schema: { type: 'integer' } },
    ]))
    const resolve = vi.fn(() => ({ status: 200, body: {} }))
    const session = createMockSession(createContractHandler(operation!, resolve))
    const response = (await session.handle(new Request(`https://params.test${path}`, { headers: { ...headers } })))!
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: issuePath })]) })
    expect(resolve).not.toHaveBeenCalled()
    await session.dispose()
  })

  it('merges path-item parameters with operation overrides and resolves local component references', async () => {
    const spec = {
      ...specification([{ $ref: '#/components/parameters/Page' }], [id, { name: 'page', in: 'query', schema: { type: 'string' } }]),
      components: {
        parameters: { Page: { name: 'page', in: 'query', schema: { $ref: '#/components/schemas/Page' } } },
        schemas: { Page: { type: 'integer', default: 3, minimum: 1 } },
      },
    }
    const [operation] = importOpenApi(spec)
    expect(operation!.parameters).toHaveLength(2)
    const session = createMockSession(createContractHandler(operation!, ({ parameters }) => ({ status: 200, body: parameters.query })))
    expect(await (await session.handle(new Request('https://params.test/users/1')))!.json()).toEqual({ page: 3 })
    await session.dispose()
  })

  it('clones default arrays per request and never inserts defaults into the request URL', async () => {
    const [operation] = importOpenApi(specification([
      id,
      { name: 'tags', in: 'query', schema: { type: 'array', items: { type: 'string' }, default: ['default'] } },
    ]))
    const session = createMockSession(createContractHandler(operation!, ({ parameters, request }) => {
      expect(request.url).not.toContain('?')
      const tags = parameters.query['tags'] as string[]
      expect(tags).toEqual(['default'])
      tags.push('changed')
      return { status: 200, body: tags }
    }))
    for (let index = 0; index < 2; index++) {
      await (await session.handle(new Request('https://params.test/users/1')))!.arrayBuffer()
    }
    expect((operation!.parameters![1]!.schema as Record<string, unknown>)['default']).toEqual(['default'])
    await session.dispose()
  })

  it('enforces required header/cookie fields and item constraints without exposing request values', async () => {
    const [operation] = importOpenApi(specification([
      id,
      { name: 'x-required', in: 'header', required: true, schema: { type: 'string', default: 'fallback' } },
      { name: 'session', in: 'cookie', required: true, schema: { type: 'integer' } },
      { name: 'ids', in: 'query', schema: { type: 'array', items: { type: 'integer', minimum: 1 } } },
    ]))
    const session = createMockSession(createContractHandler(operation!, () => ({ status: 200, body: {} })))
    const response = (await session.handle(new Request('https://params.test/users/1?ids=1&ids=0', {
      headers: { cookie: 'session=PRIVATE_SECRET' },
    })))!
    const body = await response.text()
    expect(response.status).toBe(400)
    expect(body).not.toContain('PRIVATE_SECRET')
    expect(JSON.parse(body)).toMatchObject({ issues: expect.arrayContaining([
      expect.objectContaining({ path: '/parameters/header/x-required', keyword: 'required' }),
      expect.objectContaining({ path: '/parameters/cookie/session' }),
      expect.objectContaining({ path: '/parameters/query/ids/1', keyword: 'minimum' }),
    ]) })
    await session.dispose()
  })

  it('treats prototype-named parameters as ordinary own data', async () => {
    const [operation] = importOpenApi(specification([id, { name: '__proto__', in: 'query', schema: { type: 'string' } }]))
    const session = createMockSession(createContractHandler(operation!, ({ parameters }) => {
      expect(Object.getPrototypeOf(parameters.query)).toBeNull()
      expect(Object.hasOwn(parameters.query, '__proto__')).toBe(true)
      return { status: 200, body: parameters.query }
    }))
    const result = await (await session.handle(new Request('https://params.test/users/1?__proto__=ordinary')))!.json()
    expect(result).toEqual(JSON.parse('{"__proto__":"ordinary"}'))
    await session.dispose()
  })

  it('imports OpenAPI 3.0 parameters and ignores reserved OpenAPI header definitions', () => {
    const [operation] = importOpenApi({
      ...specification([id, { name: 'Authorization', in: 'header', required: true, schema: { type: 'string' } }]),
      openapi: '3.0.3',
    })
    expect(operation!.parameters).toHaveLength(1)
  })

  it('distinguishes absent defaults from explicitly allowed empty query values', async () => {
    for (const allowEmptyValue of [false, true]) {
      const [operation] = importOpenApi(specification([id, {
        name: 'q',
        in: 'query',
        allowEmptyValue,
        schema: { type: 'string', default: 'fallback' },
      }]))
      const session = createMockSession(createContractHandler(operation!, ({ parameters }) => ({ status: 200, body: parameters.query })))
      expect(await (await session.handle(new Request('https://params.test/users/1')))!.json()).toEqual({ q: 'fallback' })
      const empty = (await session.handle(new Request('https://params.test/users/1?q=')))!
      expect(empty.status).toBe(allowEmptyValue ? 200 : 400)
      if (allowEmptyValue) {
        expect(await empty.json()).toEqual({ q: '' })
      }
      else {
        await empty.arrayBuffer()
      }
      await session.dispose()
    }
  })

  it('parses deepObject, spaceDelimited and pipeDelimited query parameters', async () => {
    const [operation] = importOpenApi(specification([
      id,
      {
        name: 'filter',
        in: 'query',
        style: 'deepObject',
        required: true,
        schema: {
          type: 'object',
          required: ['role', 'limit'],
          properties: {
            role: { type: 'string' },
            limit: { type: 'integer' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      { name: 'ids', in: 'query', style: 'spaceDelimited', schema: { type: 'array', items: { type: 'integer' } } },
      { name: 'fields', in: 'query', style: 'pipeDelimited', schema: { type: 'array', items: { type: 'string' } } },
    ]))
    const session = createMockSession(createContractHandler(operation!, ({ parameters }) => ({ status: 200, body: parameters.query })))
    const response = await session.handle(new Request('https://params.test/users/1?filter[role]=admin&filter[limit]=2&filter[tags]=one&filter[tags]=two&ids=3%204&fields=name%7Cemail'))
    expect(await response!.json()).toEqual({
      filter: { role: 'admin', limit: 2, tags: ['one', 'two'] },
      ids: [3, 4],
      fields: ['name', 'email'],
    })
    await session.dispose()
  })

  it('parses form/simple, label and matrix object and array styles', async () => {
    const [operation] = importOpenApi(specification([
      { name: 'queryObject', in: 'query', explode: false, schema: { type: 'object', properties: { role: { type: 'string' }, active: { type: 'boolean' } } } },
      { name: 'simpleObject', in: 'path', required: true, schema: { type: 'object', properties: { role: { type: 'string' }, active: { type: 'boolean' } } } },
      { name: 'labels', in: 'path', required: true, style: 'label', schema: { type: 'array', items: { type: 'string' } } },
      { name: 'matrix', in: 'path', required: true, style: 'matrix', schema: { type: 'array', items: { type: 'integer' } } },
    ], [], '/users/{simpleObject}/{labels}/{matrix}'))
    const session = createMockSession(createContractHandler(operation!, ({ parameters }) => ({ status: 200, body: parameters })))
    const response = await session.handle(new Request('https://params.test/users/role,admin,active,true/.one.two/;matrix=3,4?queryObject=role,admin,active,true'))
    expect(await response!.json()).toEqual({
      path: {
        simpleObject: { role: 'admin', active: true },
        labels: ['one', 'two'],
        matrix: [3, 4],
      },
      query: { queryObject: { role: 'admin', active: true } },
      header: {},
      cookie: {},
    })
    await session.dispose()
  })

  it('parses exploded object values from headers and cookies', async () => {
    const [operation] = importOpenApi(specification([
      id,
      { name: 'meta', in: 'header', explode: true, schema: { type: 'object', properties: { role: { type: 'string' }, active: { type: 'boolean' } } } },
      { name: 'prefs', in: 'cookie', schema: { type: 'object', properties: { role: { type: 'string' }, active: { type: 'boolean' } } } },
    ]))
    const session = createMockSession(createContractHandler(operation!, ({ parameters }) => ({ status: 200, body: parameters })))
    const response = await session.handle(new Request('https://params.test/users/1', {
      headers: { meta: 'role=admin,active=true', cookie: 'role=admin; active=true' },
    }))
    expect(await response!.json()).toEqual({
      path: { id: 1 },
      query: {},
      header: { meta: { role: 'admin', active: true } },
      cookie: { prefs: { role: 'admin', active: true } },
    })
    await session.dispose()
  })

  it.each([
    [{ name: 'x', in: 'query', style: 'unknown', schema: { type: 'string' } }, 'style'],
    [{ name: 'x', in: 'query', style: 'deepObject', schema: { type: 'string' } }, 'object'],
    [{ name: 'x', in: 'query', schema: { type: 'integer', default: 'wrong' } }, 'integer'],
    [{ name: 'x', in: 'query', schema: { $ref: 'https://remote.test/schema' } }, 'local'],
    [{ name: 'x', in: 'cookie', schema: { type: 'array', items: { type: 'string' } } }, 'explode'],
    [{ name: 'x', in: 'query', content: { 'application/json': { schema: true } } }, 'schema'],
    [{ name: 'id', in: 'path', schema: { type: 'integer' } }, 'required'],
    [{ name: 'x', in: 'query', required: 'false', schema: { type: 'string' } }, 'boolean'],
  ])('rejects unsupported or invalid parameter contracts at import: %j', (parameter, message) => {
    expect(() => importOpenApi(specification([parameter]))).toThrow(String(message))
  })
})
