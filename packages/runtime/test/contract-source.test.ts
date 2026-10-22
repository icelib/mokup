import type { HttpHandler } from '../src/http'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createContractHandler, generateContractSource, schemaToTypeScript } from '../src/contract'
import { createMockSession } from '../src/http'

describe('conservative contract TypeScript types', () => {
  it('expresses required and optional fields, enums, arrays and local references', () => {
    expect(schemaToTypeScript({
      type: 'object',
      required: ['id'],
      additionalProperties: false,
      properties: { id: { $ref: '#/$defs/id' }, role: { enum: ['admin', 'reader'] }, tags: { type: 'array', items: { type: 'string' } } },
      $defs: { id: { type: 'integer' } },
    })).toBe('{ "id": number; "role"?: "admin" | "reader"; "tags"?: Array<string> }')
    expect(schemaToTypeScript({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('(string) | (null)')
    expect(schemaToTypeScript(false)).toBe('never')
  })

  it('does not invent types for unsupported, recursive or missing references', () => {
    expect(schemaToTypeScript({ if: {}, then: {}, type: 'string' })).toBe('unknown')
    expect(schemaToTypeScript({ $ref: 'https://schema.test/types' })).toBe('unknown')
    expect(schemaToTypeScript({ $ref: '#/$defs/missing' })).toBe('unknown')
    expect(schemaToTypeScript({ $ref: '#/$defs/loop', $defs: { loop: { $ref: '#/$defs/loop' } } })).toBe('unknown')
  })
})

describe('generated typed handler module', () => {
  const spec = {
    openapi: '3.1.0',
    paths: {
      '/users': { post: {
        operationId: 'createUser',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } }, additionalProperties: false } } } },
        responses: {
          201: { content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } }, additionalProperties: false } } } },
          204: { description: 'Empty' },
        },
      } },
    },
  }

  it('is deterministic and exports typed inputs, replies, fixtures and a factory', () => {
    const source = generateContractSource(spec)
    expect(source).toBe(generateContractSource(spec))
    expect(source).toContain('export type Operation_createUser_')
    expect(source).toContain('"POST /users": ContractResolver<')
    expect(source).toContain('status: 201; body: { "id": number }')
    expect(source).toContain('status: 204; body?: never')
    expect(source).toContain('export const fixtures:')
    expect(source).toContain('export function createHandlers')
  })

  it('executes the generated module and enforces its runtime bridge', async () => {
    const source = generateContractSource(spec)
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true })
    expect(compiled.diagnostics).toEqual([])
    const output: { createHandlers?: (resolvers: Record<string, unknown>) => HttpHandler[], fixtures?: unknown[] } = {}
    // eslint-disable-next-line no-new-func -- Execute the generated module, with only the tested local bridge available as an import.
    const evaluate = new Function('require', 'exports', compiled.outputText)
    evaluate((specifier: string) => {
      expect(specifier).toBe('mokup/contract')
      return { createContractHandler }
    }, output)
    expect(output.fixtures).toHaveLength(2)
    const handlers = output.createHandlers!({ 'POST /users': () => ({ status: 201, body: { id: 7 } }) })
    const session = createMockSession(...handlers)
    const valid = new Request('https://generated.test/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Ada"}' })
    const response = (await session.handle(valid))!
    expect(await response.json()).toEqual({ id: 7 })
    const missing = (await session.handle(new Request('https://generated.test/users', { method: 'POST' })))!
    expect(missing.status).toBe(400)
    await missing.arrayBuffer()
    await session.dispose()
  })
})
