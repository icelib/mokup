import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkContractFile, diffContractFiles } from '../src/contract-command'
import { runCli } from '../src/program'

describe('contract CLI', () => {
  let directory: string
  let contract: string
  let fixtures: string
  let exitCode: typeof process.exitCode
  const document = {
    openapi: '3.1.0',
    paths: { '/users/{id}': { post: {
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'integer', minimum: 2 } } } },
      responses: {
        200: { content: { 'application/json': { schema: { type: 'string', const: 'created' } } } },
        204: { description: 'Empty' },
      },
    } } },
  }

  beforeEach(async () => {
    exitCode = process.exitCode
    directory = await mkdtemp(join(tmpdir(), 'mokup-contract-'))
    contract = join(directory, 'openapi.json')
    fixtures = join(directory, 'fixtures.json')
    await writeFile(contract, JSON.stringify(document))
  })

  afterEach(async () => {
    process.exitCode = exitCode
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })

  it('generates fixtures that validate required requests and bodyless responses', async () => {
    await runCli(['node', 'mokup', 'generate', '--contract', contract, '--out', fixtures])
    expect(JSON.parse(await readFile(fixtures, 'utf8'))).toHaveLength(2)
    await expect(checkContractFile({ contract, fixtures })).resolves.toMatchObject({ valid: true, operationCount: 1, fixtureCount: 2 })
    await expect(runCli(['node', 'mokup', 'generate', '--contract', contract, '--out', fixtures])).rejects.toThrow('EEXIST')
  })

  it('generates and validates request headers for contract parameters', async () => {
    await writeFile(contract, JSON.stringify({
      openapi: '3.1.0',
      paths: { '/items/{id}': { get: {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'filter', in: 'query', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'x-tenant', in: 'header', required: true, schema: { type: 'string', minLength: 1 } },
        ],
        responses: { 200: { content: { 'application/json': { schema: { type: 'object' } } } } },
      } } },
    }))
    await runCli(['node', 'mokup', 'generate', '--contract', contract, '--out', fixtures])
    const generated = JSON.parse(await readFile(fixtures, 'utf8'))
    expect(generated[0]).toMatchObject({ path: '/items/1?filter=x', requestHeaders: { 'x-tenant': 'x' } })
    await expect(checkContractFile({ contract, fixtures })).resolves.toMatchObject({ valid: true, fixtureCount: 1 })
  })

  it('accepts YAML contracts and resolves local external references', async () => {
    const schema = join(directory, 'schemas.yaml')
    const yamlContract = join(directory, 'openapi.yaml')
    const output = join(directory, 'yaml-fixtures.json')
    await writeFile(schema, [
      'User:',
      '  type: object',
      '  required: [id]',
      '  properties:',
      '    id:',
      '      type: integer',
      '      minimum: 1',
    ].join('\n'))
    await writeFile(yamlContract, [
      'openapi: 3.1.0',
      'info:',
      '  title: External',
      '  version: 1.0.0',
      'components:',
      '  schemas:',
      '    Local:',
      '      type: string',
      '      example: local',
      'paths:',
      '  /users/{id}:',
      '    get:',
      '      responses:',
      '        "200":',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: ./schemas.yaml#/User',
      '  /local:',
      '    get:',
      '      responses:',
      '        "200":',
      '          content:',
      '            application/json:',
      '              schema:',
      '                $ref: "#/components/schemas/Local"',
    ].join('\n'))
    await runCli(['node', 'mokup', 'generate', '--contract', yamlContract, '--out', output])
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(expect.arrayContaining([expect.objectContaining({ body: { id: 1 } }), expect.objectContaining({ body: 'local' })]))
    await expect(checkContractFile({ contract: yamlContract })).resolves.toMatchObject({ valid: true, operationCount: 2 })
  })

  it('reports malformed, unknown, request and response violations with fixture indexes', async () => {
    await writeFile(fixtures, JSON.stringify([
      {},
      { method: 'GET', path: '/unknown', status: 200 },
      { method: 'POST', path: '/users/1', status: 200, body: 123 },
      { method: 'POST', path: '/users/1', status: 204, body: null, requestBody: 1 },
    ]))
    const report = await checkContractFile({ contract, fixtures })
    expect(report.valid).toBe(false)
    expect([...new Set(report.failures.map(failure => failure.index))]).toEqual([0, 1, 2, 3])
    expect(report.failures).toContainEqual({ index: 2, message: 'Required requestBody is missing.' })
    expect(report.failures.some(failure => failure.index === 2 && failure.message.startsWith('response'))).toBe(true)
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runCli(['node', 'mokup', 'check', '--contract', contract, '--fixtures', fixtures, '--json'])
    expect(process.exitCode).toBe(1)
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual(report)
  })

  it('compares generated response fixtures and reports contract violations', async () => {
    await writeFile(contract, JSON.stringify({
      openapi: '3.1.0',
      paths: { '/users/{id}': { get: { responses: {
        200: { content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } } } },
      } } } },
    }))
    const expected = join(directory, 'expected.json')
    const actual = join(directory, 'actual.json')
    await writeFile(expected, JSON.stringify({ method: 'GET', path: '/users/1', status: 200, headers: { 'content-type': 'application/json' }, body: { id: 1 } }))
    await writeFile(actual, JSON.stringify({ method: 'GET', path: '/users/1', status: 200, headers: { 'content-type': 'application/json' }, body: { id: 'wrong' } }))
    const report = await diffContractFiles({ contract, expected, actual })
    expect(report.valid).toBe(false)
    expect(report.operation).toEqual({ method: 'GET', path: '/users/:id' })
    expect(report.actual).toMatchObject({ valid: false })
    expect(report.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'invalid', side: 'actual', path: '/id', keyword: 'type' }),
    ]))
  })

  it('validates serialized path, query, header and cookie parameters in fixtures', async () => {
    await writeFile(contract, JSON.stringify({
      openapi: '3.1.0',
      paths: { '/items/{id}': { get: {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'filter', in: 'query', required: true, schema: { type: 'string', minLength: 2 } },
          { name: 'x-tenant', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'session', in: 'cookie', required: true, schema: { type: 'string', minLength: 3 } },
        ],
        responses: { 200: { content: { 'application/json': { schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } } } } },
      } } },
    }))
    await writeFile(fixtures, JSON.stringify([
      { method: 'GET', path: '/items/2?filter=ok', headers: { 'x-tenant': 'acme', 'cookie': 'session=abc' }, status: 200, body: { ok: true } },
      { method: 'GET', path: '/items/nope?filter=x', headers: { 'x-tenant': 'acme', 'cookie': 'session=ab' }, status: 200, body: { ok: true } },
    ]))
    const report = await checkContractFile({ contract, fixtures })
    expect(report.valid).toBe(false)
    expect(report.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 1, message: expect.stringContaining('/parameters/path/id') }),
      expect.objectContaining({ index: 1, message: expect.stringContaining('/parameters/query/filter') }),
      expect.objectContaining({ index: 1, message: expect.stringContaining('/parameters/cookie/session') }),
    ]))
  })

  it('reports malformed fixture URLs without aborting the batch', async () => {
    await writeFile(fixtures, JSON.stringify([
      { method: 'GET', path: 'http://[invalid', status: 200, body: null },
      { method: 'POST', path: '/users/1', status: 204, body: null, requestBody: 2 },
    ]))
    const report = await checkContractFile({ contract, fixtures })
    expect(report.fixtureCount).toBe(2)
    expect(report.failures[0]).toMatchObject({ index: 0, message: expect.stringContaining('Fixture path is invalid') })
    expect(report.failures.some(failure => failure.index === 1)).toBe(false)
  })

  it('generates a TypeScript module and rejects unknown formats', async () => {
    const output = join(directory, 'contract.ts')
    await runCli(['node', 'mokup', 'generate', '--contract', contract, '--out', output, '--format', 'typescript'])
    const source = await readFile(output, 'utf8')
    expect(source).toContain('createHandlers')
    expect(source).toContain('ContractResolvers')
    await expect(runCli(['node', 'mokup', 'generate', '--contract', contract, '--out', fixtures, '--format', 'yaml'])).rejects.toThrow('json or typescript')
  })

  it('reports invalid contracts and refuses a fixtures flag without a contract', async () => {
    await writeFile(contract, '{')
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await runCli(['node', 'mokup', 'check', '--contract', contract, '--json'])
    expect(process.exitCode).toBe(1)
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ valid: false, error: { message: expect.any(String) } })
    output.mockClear()
    await runCli(['node', 'mokup', 'check', '--fixtures', fixtures, '--json'])
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ valid: false, error: { message: '--fixtures requires --contract.' } })
  })
})
