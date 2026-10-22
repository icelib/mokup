import type { OpenApiOperation } from './contract'
import { createContract, generateContractSource, generateOpenApiFixtures, importOpenApi, validateOpenApiParameters, validateOpenApiResponse } from './contract'
import { matchRouteTokens, parseRouteTemplate } from './router'

export interface McpTextContent {
  type: 'text'
  text: string
}

export interface McpToolResult<StructuredContent extends object = Record<string, unknown>> {
  content: McpTextContent[]
  isError?: boolean
  structuredContent?: StructuredContent
}

/** Stable issue shape used by the contract review tools. */
export interface McpContractIssue {
  path: string
  keyword: string
  message: string
}

/** A generated OpenAPI fixture that can be sent directly to `mokup.validate`. */
export interface McpGeneratedFixture {
  method: string
  path: string
  status: number
  headers: Record<string, string>
  body: unknown
  requestHeaders?: Record<string, string>
  requestBody?: unknown
}

export interface McpOperationSummary {
  method: string
  path: string
  operationId?: string | undefined
  responses?: string[]
}

export interface McpContractValidation {
  valid: boolean
  issues: McpContractIssue[]
}

export interface McpParameterValidation extends McpContractValidation {
  values: unknown
}

export interface McpFixtureValidation {
  index: number
  method: string
  path: string
  valid: boolean
  response: McpContractValidation
  request: {
    valid: boolean
    parameters: McpParameterValidation
    body: McpContractValidation
  }
}

export interface McpInspectStructuredContent extends Record<string, unknown> {
  schemaVersion: 1
  operations: McpOperationSummary[]
}

export interface McpGenerateStructuredContent extends Record<string, unknown> {
  schemaVersion: 1
  source: string
  fixtures: McpGeneratedFixture[]
  operations: McpOperationSummary[]
  review: {
    generatedBy: 'mokup'
    operationCount: number
    fixtureCount: number
    requiresHumanReview: true
  }
}

export interface McpValidationStructuredContent extends Record<string, unknown> {
  schemaVersion: 1
  valid: boolean
  fixtures: McpFixtureValidation[]
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown> | readonly unknown[]
}

export interface McpResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number, message: string, data?: unknown }
}

export interface MokupMcpServer {
  tools: () => readonly McpToolDefinition[]
  callTool: (name: string, arguments_: Record<string, unknown>) => Promise<McpToolResult>
  handle: (request: McpRequest) => Promise<McpResponse | undefined>
}

export interface McpHttpHandlerOptions {
  /** Additional response headers, useful for authentication or tracing. */
  headers?: HeadersInit
  /** Add permissive CORS headers for browser-hosted MCP clients. */
  cors?: boolean | HeadersInit
}

export type McpHttpHandler = (request: Request) => Promise<Response>

function isRequestId(value: unknown): value is string | number | null {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

function isMcpRequest(value: unknown): value is McpRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const request = value as Record<string, unknown>
  if (request['jsonrpc'] !== '2.0' || typeof request['method'] !== 'string') {
    return false
  }
  if ('id' in request && !isRequestId(request['id'])) {
    return false
  }
  if ('params' in request && request['params'] !== undefined
    && (typeof request['params'] !== 'object' || request['params'] === null)) {
    return false
  }
  return true
}

function createMcpHttpHeaders(options: McpHttpHandlerOptions): Headers {
  const headers = new Headers(options.headers)
  if (options.cors) {
    const cors = options.cors === true ? { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'POST, OPTIONS' } : options.cors
    for (const [name, value] of new Headers(cors)) {
      headers.set(name, value)
    }
  }
  return headers
}

/**
 * Expose a transport-neutral MCP server through a Fetch-compatible HTTP host.
 * Notifications return `202` with an empty body. A syntactically valid
 * JSON-RPC request always receives a `200` response, including JSON-RPC error
 * objects; malformed JSON and invalid envelopes receive `400`.
 */
export function createMcpHttpHandler(server: MokupMcpServer, options: McpHttpHandlerOptions = {}): McpHttpHandler {
  const baseHeaders = createMcpHttpHeaders(options)
  return async (request) => {
    const headers = new Headers(baseHeaders)
    if (request.method === 'OPTIONS') {
      headers.set('allow', 'POST, OPTIONS')
      return new Response(null, { status: 204, headers })
    }
    if (request.method !== 'POST') {
      headers.set('allow', 'POST, OPTIONS')
      return new Response('MCP HTTP transport accepts POST requests.', { status: 405, headers })
    }
    let input: unknown
    try {
      input = await request.json()
    }
    catch {
      return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }, { status: 400, headers })
    }
    if (!isMcpRequest(input)) {
      return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request.' } }, { status: 400, headers })
    }
    let response: McpResponse | undefined
    try {
      response = await server.handle(input as McpRequest)
    }
    catch (error) {
      const value = input as unknown as Record<string, unknown>
      const id = typeof value['id'] === 'string' || typeof value['id'] === 'number' || value['id'] === null ? value['id'] : null
      return Response.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: error instanceof Error ? error.message : String(error) },
      }, { status: 200, headers })
    }
    if (!response) {
      return new Response(null, { status: 202, headers })
    }
    return Response.json(response, { status: 200, headers })
  }
}

const tools: readonly McpToolDefinition[] = [
  {
    name: 'mokup.generate',
    description: 'Generate reviewable Mokup TypeScript handlers and fixtures from an OpenAPI 3.0/3.1 document.',
    inputSchema: {
      type: 'object',
      properties: { contract: { type: 'object' } },
      required: ['contract'],
      additionalProperties: false,
    },
  },
  {
    name: 'mokup.validate',
    description: 'Validate OpenAPI response fixtures and return operation-level issues for review.',
    inputSchema: {
      type: 'object',
      properties: { contract: { type: 'object' }, fixtures: { type: 'array' } },
      required: ['contract', 'fixtures'],
      additionalProperties: false,
    },
  },
  {
    name: 'mokup.inspect',
    description: 'List normalized OpenAPI operations and response statuses without generating code.',
    inputSchema: {
      type: 'object',
      properties: { contract: { type: 'object' } },
      required: ['contract'],
      additionalProperties: false,
    },
  },
]

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

function operationForFixture(operations: OpenApiOperation[], fixture: Record<string, unknown>): OpenApiOperation {
  const method = String(fixture['method'] ?? '').toLowerCase()
  const path = String(fixture['path'] ?? '')
  let pathname: string
  try {
    pathname = new URL(path, 'https://mokup.local').pathname
  }
  catch {
    throw new TypeError(`Fixture path is invalid: ${path}.`)
  }
  const operation = operations.find((candidate) => {
    if (candidate.method.toLowerCase() !== method) {
      return false
    }
    const template = candidate.path.replace(/:([^/]+)/gu, '[$1]')
    return matchRouteTokens(parseRouteTemplate(template).tokens, pathname) !== null
  })
  if (!operation) {
    throw new TypeError(`No OpenAPI operation matches ${method.toUpperCase()} ${path}.`)
  }
  return operation
}

function issueResult(message: string): McpToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  }
}

/**
 * A dependency-free MCP JSON-RPC surface for contract-aware generation.
 *
 * Transport is deliberately left to the host (stdio, HTTP, or an embedded
 * Devframe panel), keeping the Mokup runtime free of MCP SDK dependencies.
 */
export function createMokupMcpServer(): MokupMcpServer {
  const callTool = async (name: string, arguments_: Record<string, unknown>): Promise<McpToolResult> => {
    try {
      const document = arguments_['contract']
      if (name === 'mokup.inspect') {
        const operations = importOpenApi(document)
        const structuredContent: McpInspectStructuredContent = {
          schemaVersion: 1,
          operations: operations.map(operation => ({
            method: operation.method.toUpperCase(),
            path: operation.path,
            operationId: operation.operationId,
            responses: Object.keys(operation.responses),
          })),
        }
        return { content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent }
      }
      if (name === 'mokup.generate') {
        const operations = importOpenApi(document)
        const fixtures = generateOpenApiFixtures(document)
        const source = generateContractSource(document)
        const structuredContent: McpGenerateStructuredContent = {
          schemaVersion: 1,
          source,
          fixtures,
          operations: operations.map(operation => ({ method: operation.method.toUpperCase(), path: operation.path, operationId: operation.operationId })),
          review: {
            generatedBy: 'mokup',
            operationCount: operations.length,
            fixtureCount: fixtures.length,
            requiresHumanReview: true,
          },
        }
        return { content: [{ type: 'text', text: source }], structuredContent }
      }
      if (name === 'mokup.validate') {
        const operations = importOpenApi(document)
        const rawFixtures = arguments_['fixtures']
        if (!Array.isArray(rawFixtures)) {
          throw new TypeError('fixtures must be an array.')
        }
        const results: McpFixtureValidation[] = rawFixtures.map((value, index) => {
          const fixture = asObject(value, `fixtures[${index}]`)
          const operation = operationForFixture(operations, fixture)
          const status = Number(fixture['status'])
          const headers = new Headers(fixture['headers'] as HeadersInit)
          const body = fixture['body']
          const response = validateOpenApiResponse(operation, status, headers.get('content-type') ?? 'application/json', body)
          const requestHeaders = new Headers((fixture['requestHeaders'] ?? fixture['headers']) as HeadersInit)
          const requestUrl = new URL(String(fixture['path']), 'https://mokup.local')
          const parameterResult = validateOpenApiParameters(operation, new Request(requestUrl, {
            method: operation.method,
            headers: requestHeaders,
          }))
          const requestBody = operation.requestBody === undefined || fixture['requestBody'] === undefined
            ? operation.requestRequired
              ? { valid: false, issues: [{ path: '/', keyword: 'required', message: 'Required requestBody is missing.' }] }
              : { valid: true, issues: [] }
            : createContract(operation.requestBody).validate(fixture['requestBody'])
          const request = {
            valid: parameterResult.issues.length === 0 && requestBody.valid,
            parameters: { ...parameterResult, valid: parameterResult.issues.length === 0 },
            body: requestBody,
          }
          return { index, method: operation.method.toUpperCase(), path: operation.path, valid: response.valid && request.valid, response, request }
        })
        const valid = results.every(result => result.valid)
        const structuredContent: McpValidationStructuredContent = { schemaVersion: 1, valid, fixtures: results }
        return {
          content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
          ...(valid ? {} : { isError: true }),
        }
      }
      throw new Error(`Unknown Mokup tool: ${name}`)
    }
    catch (error) {
      return issueResult(error instanceof Error ? error.message : String(error))
    }
  }

  const handle = async (request: McpRequest): Promise<McpResponse | undefined> => {
    const notification = !Object.hasOwn(request, 'id')
    const id = request.id ?? null
    if (request.method === 'notifications/initialized') {
      return undefined
    }
    if (request.method === 'ping') {
      return notification ? undefined : { jsonrpc: '2.0', id, result: {} }
    }
    if (request.method === 'initialize') {
      return notification
        ? undefined
        : {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'mokup', version: '1' },
            },
          }
    }
    if (request.method === 'tools/list') {
      return notification ? undefined : { jsonrpc: '2.0', id, result: { tools: [...tools] } }
    }
    if (request.method === 'tools/call') {
      const params = request.params ?? {}
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        return notification ? undefined : { jsonrpc: '2.0', id, error: { code: -32602, message: 'tools/call params must be an object.' } }
      }
      const objectParams = params as Record<string, unknown>
      const name = String(objectParams['name'] ?? '')
      let args: Record<string, unknown>
      try {
        args = asObject(objectParams['arguments'] ?? {}, 'arguments')
      }
      catch (error) {
        return notification ? undefined : { jsonrpc: '2.0', id, error: { code: -32602, message: error instanceof Error ? error.message : String(error) } }
      }
      return notification ? undefined : { jsonrpc: '2.0', id, result: await callTool(name, args) }
    }
    return notification ? undefined : { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${request.method}` } }
  }

  return {
    tools: () => tools,
    callTool,
    handle,
  }
}
