import { describe, expect, it } from 'vitest'
import { ContractError, createContract, diffOpenApiResponse, generateFixture, generateOpenApiFixtures, importOpenApi, validateOpenApiParameters, validateOpenApiResponse } from '../src/contract'

describe('JSON Schema contracts', () => {
  it('reports all failures without coercing or mutating input', () => {
    const contract = createContract<{ id: number }>({
      type: 'object',
      required: ['id'],
      additionalProperties: false,
      properties: { id: { type: 'integer', minimum: 1 } },
    })
    const value = { id: '2', extra: true }
    expect(contract.validate(value)).toMatchObject({ valid: false, issues: expect.arrayContaining([
      expect.objectContaining({ path: '/id', keyword: 'type' }),
      expect.objectContaining({ keyword: 'additionalProperties' }),
    ]) })
    expect(value).toEqual({ id: '2', extra: true })
    expect(() => contract.parse(value)).toThrow(ContractError)
    expect(contract.parse({ id: 1 })).toEqual({ id: 1 })
  })

  it('generates validated fixtures including references and formats', () => {
    const schema = {
      type: 'object',
      required: ['ids', 'email'],
      properties: { ids: { type: 'array', minItems: 2, items: { $ref: '#/$defs/id' } }, email: { type: 'string', format: 'email' } },
      $defs: { id: { type: 'integer', minimum: 7 } },
    }
    expect(generateFixture(schema)).toEqual({ ids: [7, 7], email: 'mock@example.com' })
    expect(generateFixture(schema)).toEqual(generateFixture(schema))
    expect(() => generateFixture({ type: 'string', pattern: '^[A-Z]+$' })).toThrow(ContractError)
    expect(() => createContract({ $ref: 'https://example.com/schema.json' })).toThrow()
  })
})

describe('OpenAPI JSON contracts', () => {
  const spec = {
    openapi: '3.0.3',
    components: { schemas: { User: {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'integer', minimum: 0, exclusiveMinimum: true },
        name: { type: 'string', nullable: true, example: 'Ada' },
      },
    } } },
    paths: { '/users/{id}': { get: {
      operationId: 'getUser',
      responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
    } } },
  }

  it('normalizes nullable and exclusive bounds and resolves local references', () => {
    const [operation] = importOpenApi(spec)
    expect(operation).toMatchObject({ path: '/users/:id', method: 'GET', operationId: 'getUser' })
    expect(generateOpenApiFixtures(spec)).toEqual([{
      path: '/users/:id',
      method: 'GET',
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { id: 1, name: 'Ada' },
    }])
    expect(validateOpenApiResponse(operation!, 200, 'application/json; charset=utf-8', { id: 2, name: null }).valid).toBe(true)
    expect(validateOpenApiResponse(operation!, 200, 'application/json', { id: 0, name: 'Ada' }).valid).toBe(false)
    expect(validateOpenApiResponse(operation!, 404, 'application/json', {}).valid).toBe(false)
  })

  it('generates request parameter fixtures with OpenAPI serialization styles', () => {
    const document = {
      openapi: '3.1.0',
      components: { securitySchemes: { apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' } } },
      paths: { '/items/{id}': { get: {
        security: [{ apiKey: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'tags', in: 'query', explode: false, schema: { type: 'array', minItems: 2, items: { type: 'string', minLength: 1 } } },
          { name: 'tenant', in: 'header', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'session', in: 'cookie', required: true, schema: { type: 'string', minLength: 1 } },
        ],
        responses: { 200: { content: { 'application/json': { schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } } } } },
      } } },
    }
    const [fixture] = generateOpenApiFixtures(document)
    expect(fixture).toMatchObject({
      method: 'GET',
      path: '/items/1?tags=x,x',
      requestHeaders: {
        'X-API-Key': 'mock-api-key',
        'tenant': 'x',
        'cookie': 'session=x',
      },
    })
    const [operation] = importOpenApi(document)
    const request = new Request(`https://contract.test${fixture!.path}`, { headers: fixture!.requestHeaders })
    expect(validateOpenApiParameters(operation!, request).issues).toEqual([])
  })

  it('generates query and cookie API keys for the selected security requirement', () => {
    const document = {
      openapi: '3.1.0',
      components: { securitySchemes: {
        queryKey: { type: 'apiKey', name: 'api_key', in: 'query' },
        cookieKey: { type: 'apiKey', name: 'session_key', in: 'cookie' },
      } },
      paths: { '/secure': { get: {
        security: [{ queryKey: [], cookieKey: [] }],
        responses: { 200: { description: 'ok' } },
      } } },
    }
    const [fixture] = generateOpenApiFixtures(document)
    expect(fixture).toMatchObject({
      path: '/secure?api_key=mock-api-key',
      requestHeaders: { cookie: 'session_key=mock-api-key' },
    })
  })

  it('compares response values against the selected schema and reports both invalid sides', () => {
    const [operation] = importOpenApi({ openapi: '3.1.0', paths: { '/users': { get: { responses: {
      200: { content: { 'application/json': { schema: {
        type: 'object',
        required: ['id', 'name'],
        additionalProperties: false,
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
      } } } },
    } } } } })
    expect(diffOpenApiResponse(operation!, 200, 'application/json', { id: 1, name: 'Ada' }, { id: 2, name: 'Grace' })).toEqual({
      equal: false,
      expected: { valid: true, issues: [] },
      actual: { valid: true, issues: [] },
      differences: [{ path: '/id', kind: 'changed', expected: 1, actual: 2 }, { path: '/name', kind: 'changed', expected: 'Ada', actual: 'Grace' }],
      truncated: false,
    })
    const invalid = diffOpenApiResponse(operation!, 200, 'application/json', { id: 1, name: 'Ada' }, { id: 'wrong', extra: true })
    expect(invalid.actual.valid).toBe(false)
    expect(invalid.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'invalid', side: 'actual', path: '/id', keyword: 'type' }),
      expect.objectContaining({ kind: 'invalid', side: 'actual', keyword: 'additionalProperties' }),
    ]))
  })

  it('bounds contract differences and handles empty response contracts', () => {
    const [operation] = importOpenApi({ openapi: '3.1.0', paths: { '/empty': { get: { responses: {
      204: { description: 'No content' },
    } } } } })
    expect(diffOpenApiResponse(operation!, 204, '', null, null)).toMatchObject({ equal: true, truncated: false })
    const invalidEmpty = diffOpenApiResponse(operation!, 204, '', null, 'unexpected')
    expect(invalidEmpty.equal).toBe(false)
    expect(invalidEmpty.differences).toEqual(expect.arrayContaining([{ path: '/', kind: 'invalid', side: 'actual', keyword: 'response', message: 'Expected an empty response for 204' }]))
    const [values] = importOpenApi({ openapi: '3.1.0', paths: { '/values': { get: { responses: {
      200: { content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
    } } } } })
    expect(diffOpenApiResponse(values!, 200, 'application/json', { a: 1, b: 2 }, { a: 2, b: 3 }, { maxDifferences: 1 })).toMatchObject({
      equal: false,
      truncated: true,
      differences: [{ path: '/a', kind: 'changed', expected: 1, actual: 2 }],
    })
    expect(() => diffOpenApiResponse(values!, 200, 'application/json', {}, {}, { maxDifferences: 0 })).toThrow('positive')
  })

  it('validates 3.1 schemas and rejects unsupported documents', () => {
    expect(importOpenApi({ openapi: '3.1.0', paths: {} })).toEqual([])
    expect(() => importOpenApi({ swagger: '2.0' })).toThrow('OpenAPI 3.0 or 3.1')
    expect(() => importOpenApi({ openapi: '3.1.0', paths: { '/a': { $ref: 'remote.json' } } })).toThrow('Only local')
  })

  it('preserves application data inside legacy examples and supports response classes and media wildcards', () => {
    const body = { nullable: true, exclusiveMinimum: true, minimum: 7 }
    const [operation] = importOpenApi({ openapi: '3.0.3', paths: { '/example': { get: { responses: {
      '2XX': { content: { 'application/*': { schema: { type: 'object', example: body } } } },
      '204': { description: 'Empty' },
    } } } } })
    expect(generateFixture(operation!.responses['2XX']!['application/*']!)).toEqual(body)
    expect(validateOpenApiResponse(operation!, 201, 'application/json', body).valid).toBe(true)
    expect(validateOpenApiResponse(operation!, 204, '', null).valid).toBe(true)
    expect(validateOpenApiResponse(operation!, 204, '', body).valid).toBe(false)
  })

  it('imports security requirements and multipart request media types', () => {
    const [global, publicOperation] = importOpenApi({
      openapi: '3.1.0',
      security: [{ apiKey: [] }],
      components: { securitySchemes: {
        apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      } },
      paths: {
        '/upload': { post: {
          requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object' } } } },
          responses: { 201: { content: { 'application/json': { schema: { type: 'object' } } } } },
        } },
        '/public': { get: {
          security: [],
          responses: { 200: { content: { 'application/json': { schema: { type: 'object' } } } } },
        } },
      },
    })
    expect(global).toMatchObject({
      path: '/upload',
      method: 'POST',
      requestRequired: true,
      requestBodyContentType: 'multipart/form-data',
      security: [{ apiKey: [] }],
      securitySchemes: { apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' }, bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    })
    expect(publicOperation).toMatchObject({ path: '/public', security: [] })
  })
})
