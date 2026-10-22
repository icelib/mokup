import type { OpenApiOperation } from '../src/contract'
import { describe, expect, it, vi } from 'vitest'
import { ContractError, createContractHandler } from '../src/contract'
import { createMockSession } from '../src/http'

function operation(extra: Partial<OpenApiOperation> = {}): OpenApiOperation {
  return {
    method: 'POST',
    path: '/users',
    requestRequired: true,
    requestBody: { type: 'object', required: ['name'], properties: { name: { type: 'string' } }, additionalProperties: false },
    responses: {
      201: { 'application/json': { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
      400: { 'application/problem+json': { type: 'object', required: ['error'], properties: { error: { type: 'string' } } } },
      204: {},
    },
    ...extra,
  }
}

function request(body?: string, contentType = 'application/json') {
  return new Request('https://contract.test/users', { method: 'POST', headers: { 'content-type': contentType }, ...(body === undefined ? {} : { body }) })
}

describe('JSON contract HTTP bridge', () => {
  it('validates request and reply while leaving resolver requests readable', async () => {
    const session = createMockSession(createContractHandler<{ name: string }>(operation(), async ({ body, request }) => {
      expect(body).toEqual({ name: 'Ada' })
      expect(await request.json()).toEqual(body)
      return { status: 201, body: { id: 1 } }
    }))
    const response = (await session.handle(request('{"name":"Ada"}')))!
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: 1 })
    await session.dispose()
  })

  it.each([
    [undefined, 'application/json', 400],
    ['{}', 'application/json', 400],
    ['{"name":1}', 'application/json', 400],
    ['{', 'application/json', 400],
    ['{"name":"Ada"}', 'text/plain', 415],
  ] as const)('rejects invalid request body %s before invoking a resolver', async (body, contentType, status) => {
    const resolver = vi.fn(() => ({ status: 201, body: { id: 1 } }))
    const session = createMockSession(createContractHandler(operation(), resolver))
    const response = (await session.handle(request(body, contentType)))!
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ error: 'invalid_request', issues: expect.any(Array) })
    expect(resolver).not.toHaveBeenCalled()
    await session.dispose()
  })

  it('permits absent optional input and validates declared 4xx replies', async () => {
    const session = createMockSession(createContractHandler(operation({ requestRequired: false }), ({ body }) => {
      expect(body).toBeUndefined()
      return { status: 400, body: { error: 'missing profile' } }
    }))
    const response = (await session.handle(request()))!
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.json()).toEqual({ error: 'missing profile' })
    await session.dispose()
  })

  it('rejects undeclared status and invalid mock response values', async () => {
    for (const reply of [{ status: 201, body: { id: 'wrong' } }, { status: 500, body: {} }, { status: 204, body: { forbidden: true } }]) {
      const session = createMockSession(createContractHandler(operation(), () => reply))
      await expect(session.handle(request('{"name":"Ada"}'))).rejects.toBeInstanceOf(ContractError)
      await session.dispose()
    }
  })

  it('validates the serialized response consumers receive', async () => {
    for (const body of [
      { id: 1, toJSON: () => ({ id: 'invalid wire value' }) },
      { id: 1n },
    ]) {
      const session = createMockSession(createContractHandler(operation(), () => ({ status: 201, body })))
      await expect(session.handle(request('{"name":"Ada"}'))).rejects.toBeInstanceOf(ContractError)
      await session.dispose()
    }
    const session = createMockSession(createContractHandler(operation(), () => ({
      status: 201,
      body: { toJSON: () => ({ id: 7 }) },
    })))
    expect(await (await session.handle(request('{"name":"Ada"}')))!.json()).toEqual({ id: 7 })
    await session.dispose()
  })

  it('produces real bodyless 204 and HEAD responses', async () => {
    const empty = createMockSession(createContractHandler(operation(), () => ({ status: 204 })))
    const response = (await empty.handle(request('{"name":"Ada"}')))!
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
    await empty.dispose()
    const head = createMockSession(createContractHandler(operation({ method: 'HEAD', requestRequired: false }), () => ({ status: 201, body: { id: 1 } })))
    const headResponse = (await head.handle(new Request('https://contract.test/users', { method: 'HEAD' })))!
    expect(headResponse.body).toBeNull()
    await head.dispose()
  })

  it('bounds request and response payloads', async () => {
    const limited = createMockSession(createContractHandler(operation(), () => ({ status: 201, body: { id: 1 } }), { maxBodyBytes: 4 }))
    const response = (await limited.handle(request('{"name":"Ada"}')))!
    expect(response.status).toBe(413)
    await response.arrayBuffer()
    await limited.dispose()
    const largeReply = createMockSession(createContractHandler(operation({ requestRequired: false }), () => ({ status: 201, body: { id: 100000 } }), { maxBodyBytes: 4 }))
    await expect(largeReply.handle(request())).rejects.toThrow('exceeds 4 bytes')
    await largeReply.dispose()
  })

  it('fails explicitly for a required non-JSON contract', () => {
    const input = operation()
    delete input.requestBody
    expect(() => createContractHandler(input, () => ({ status: 204 }))).toThrow('JSON schema')
  })
})

describe('OpenAPI security and multipart contracts', () => {
  const secured = operation({
    requestRequired: false,
    requestBody: undefined,
    security: [{ apiKey: [] }],
    securitySchemes: { apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' } },
  })

  it('accepts API keys from headers, query strings, and cookies', async () => {
    for (const [url, headers] of [
      ['https://contract.test/users', { 'x-api-key': 'secret' }],
      ['https://contract.test/users?key=secret', {}],
      ['https://contract.test/users', { cookie: 'key=secret' }],
    ] as const) {
      const scheme = url.includes('?')
        ? { type: 'apiKey' as const, name: 'key', in: 'query' as const }
        : headers.cookie
          ? { type: 'apiKey' as const, name: 'key', in: 'cookie' as const }
          : secured.securitySchemes!.apiKey!
      const session = createMockSession(createContractHandler({ ...secured, securitySchemes: { apiKey: scheme } }, () => ({ status: 204 })))
      expect((await session.handle(new Request(url, { method: 'POST', headers })))!.status).toBe(204)
      await session.dispose()
    }
  })

  it('supports AND requirements, alternative schemes, bearer, and public operations', async () => {
    const input = {
      ...secured,
      security: [{ apiKey: [], bearer: [] }, { apiKey: [], basic: [] }],
      securitySchemes: {
        apiKey: { type: 'apiKey' as const, name: 'X-API-Key', in: 'header' as const },
        bearer: { type: 'http' as const, scheme: 'Bearer' },
        basic: { type: 'http' as const, scheme: 'Basic' },
      },
    }
    const session = createMockSession(createContractHandler(input, () => ({ status: 204 })))
    expect((await session.handle(new Request('https://contract.test/users', { method: 'POST' })))!.status).toBe(401)
    expect((await session.handle(new Request('https://contract.test/users', { method: 'POST', headers: { 'x-api-key': 'a', 'authorization': 'Bearer token' } })))!.status).toBe(204)
    expect((await session.handle(new Request('https://contract.test/users', { method: 'POST', headers: { 'x-api-key': 'a', 'authorization': 'Basic token' } })))!.status).toBe(204)
    await session.dispose()

    const publicSession = createMockSession(createContractHandler({ ...input, security: [] }, () => ({ status: 204 })))
    expect((await publicSession.handle(new Request('https://contract.test/users', { method: 'POST' })))!.status).toBe(204)
    await publicSession.dispose()
  })

  it('validates multipart text, repeated fields, and file metadata', async () => {
    const input = operation({
      requestRequired: true,
      requestBodyContentType: 'multipart/form-data',
      requestBody: {
        type: 'object',
        required: ['title', 'tags', 'file'],
        properties: {
          title: { type: 'string' },
          tags: { type: 'array', minItems: 2, items: { type: 'string' } },
          file: { type: 'object', required: ['name', 'type', 'size'], properties: { name: { type: 'string' }, type: { type: 'string' }, size: { type: 'integer' } } },
        },
      },
    })
    const session = createMockSession(createContractHandler(input, ({ body }) => {
      expect(body).toMatchObject({ title: 'photo', tags: ['one', 'two'], file: { name: 'photo.txt', type: 'text/plain', size: 5 } })
      return { status: 201, body: { id: 1 } }
    }))
    const form = new FormData()
    form.set('title', 'photo')
    form.append('tags', 'one')
    form.append('tags', 'two')
    form.set('file', new File(['hello'], 'photo.txt', { type: 'text/plain' }))
    const response = (await session.handle(new Request('https://contract.test/users', { method: 'POST', body: form })))!
    expect(response.status).toBe(201)
    await session.dispose()
  })

  it('rejects multipart requests with the wrong media type or invalid fields', async () => {
    const input = operation({ requestBodyContentType: 'multipart/form-data', requestBody: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } })
    const resolver = vi.fn(() => ({ status: 201, body: { id: 1 } }))
    const session = createMockSession(createContractHandler(input, resolver))
    expect((await session.handle(request('{"title":"x"}')))!.status).toBe(415)
    const form = new FormData()
    form.set('other', 'x')
    expect((await session.handle(new Request('https://contract.test/users', { method: 'POST', body: form })))!.status).toBe(400)
    expect(resolver).not.toHaveBeenCalled()
    await session.dispose()

    const oversized = createMockSession(createContractHandler({ ...input, requestRequired: false }, () => ({ status: 201, body: { id: 1 } }), { maxBodyBytes: 1 }))
    const oversizedForm = new FormData()
    oversizedForm.set('title', 'x')
    expect((await oversized.handle(new Request('https://contract.test/users', { method: 'POST', body: oversizedForm })))!.status).toBe(413)
    await oversized.dispose()

    const optional = createMockSession(createContractHandler({ ...input, requestRequired: false }, () => ({ status: 201, body: { id: 1 } })))
    expect((await optional.handle(new Request('https://contract.test/users', { method: 'POST', headers: { 'content-type': 'multipart/form-data' } })))!.status).toBe(201)
    await optional.dispose()
  })
})
