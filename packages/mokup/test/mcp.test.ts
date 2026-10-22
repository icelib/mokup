import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createMcpHttpHandler, createMokupMcpServer } from '../src/mcp'
import { createMcpStdioServer } from '../src/mcp-stdio'

const contract = {
  openapi: '3.1.0',
  paths: {
    '/health': {
      get: {
        operationId: 'health',
        responses: {
          200: {
            content: {
              'application/json': {
                schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
              },
            },
          },
        },
      },
    },
  },
}

describe('Mokup MCP server', () => {
  it('implements initialize, tools/list and reviewable generation', async () => {
    const server = createMokupMcpServer()
    const initialize = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(initialize?.result).toMatchObject({ capabilities: { tools: {} } })
    const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect((listed?.result as { tools: Array<{ name: string }> }).tools.map(tool => tool.name)).toEqual([
      'mokup.generate',
      'mokup.validate',
      'mokup.inspect',
    ])
    const generated = await server.callTool('mokup.generate', { contract })
    expect(generated.structuredContent).toMatchObject({ review: { requiresHumanReview: true, operationCount: 1 } })
    expect(generated.content[0]?.text).toContain('createHandlers')
  })

  it('returns structured validation failures without throwing across the MCP boundary', async () => {
    const server = createMokupMcpServer()
    const result = await server.callTool('mokup.validate', {
      contract,
      fixtures: [{ method: 'GET', path: '/health', status: 200, headers: { 'content-type': 'application/json' }, body: { ok: 'wrong' } }],
    })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ valid: false })
  })

  it('round-trips generated fixtures through validation for reviewable contracts', async () => {
    const server = createMokupMcpServer()
    const document = {
      openapi: '3.1.0',
      paths: {
        '/users/{id}': {
          post: {
            operationId: 'updateUser',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 } } },
                },
              },
            },
            responses: {
              200: {
                content: {
                  'application/json': {
                    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
                  },
                },
              },
            },
          },
        },
      },
    }
    const generated = await server.callTool('mokup.generate', { contract: document })
    const fixtures = (generated.structuredContent as { fixtures: unknown[] }).fixtures
    expect(fixtures).toHaveLength(1)
    const validated = await server.callTool('mokup.validate', { contract: document, fixtures })
    expect(validated.isError).toBeUndefined()
    expect(validated.structuredContent).toMatchObject({
      schemaVersion: 1,
      valid: true,
      fixtures: [{ method: 'POST', request: { valid: true }, response: { valid: true } }],
    })
  })

  it('matches concrete paths and validates generated request parameters', async () => {
    const server = createMokupMcpServer()
    const result = await server.callTool('mokup.validate', {
      contract: {
        openapi: '3.1.0',
        paths: { '/users/{id}': { get: {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
            { name: 'tenant', in: 'header', required: true, schema: { type: 'string', minLength: 1 } },
          ],
          responses: { 200: { content: { 'application/json': { schema: { type: 'object' } } } } },
        } } },
      },
      fixtures: [{ method: 'GET', path: '/users/42', requestHeaders: { tenant: 'acme' }, status: 200, body: {} }],
    })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({ valid: true, fixtures: [{ request: { valid: true } }] })
  })

  it('hosts JSON-RPC through a Fetch-compatible HTTP handler', async () => {
    const server = createMokupMcpServer()
    const handle = createMcpHttpHandler(server, { cors: true })
    const initialize = await handle(new Request('https://mcp.example.test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    }))
    expect(initialize.status).toBe(200)
    expect(initialize.headers.get('access-control-allow-origin')).toBe('*')
    expect(await initialize.json()).toMatchObject({ result: { capabilities: { tools: {} } } })

    const notification = await handle(new Request('https://mcp.example.test', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }))
    expect(notification.status).toBe(202)
    expect(await notification.text()).toBe('')

    const preflight = await handle(new Request('https://mcp.example.test', { method: 'OPTIONS' }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('allow')).toBe('POST, OPTIONS')

    const invalid = await handle(new Request('https://mcp.example.test', { method: 'POST', body: '{' }))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: { code: -32700 } })

    const invalidParams = await handle(new Request('https://mcp.example.test', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { arguments: [] } }),
    }))
    expect(invalidParams.status).toBe(200)
    expect(await invalidParams.json()).toMatchObject({ id: 2, error: { code: -32602 } })

    const pingNotification = await handle(new Request('https://mcp.example.test', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping' }),
    }))
    expect(pingNotification.status).toBe(202)
    expect(await pingNotification.text()).toBe('')
  })

  it('hosts newline-delimited JSON over injected stdio streams', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const chunks: string[] = []
    output.on('data', chunk => chunks.push(String(chunk)))
    const host = createMcpStdioServer(createMokupMcpServer(), { input, output })
    const running = host.start()
    input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n{\n`)
    await running
    expect(chunks.join('')).toContain('"id":1')
    expect(chunks.join('')).toContain('"code":-32700')
  })
})
