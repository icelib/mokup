import type {
  OpenApiParameter,
  ParameterObject,
  ParameterScalar,
  ParameterValue,
} from './parameters'
import type { JsonSchema } from './validate'
import { generateFixture, resolvePointer } from './generate'
import { importParameters } from './parameter-import'
import { compileParameters } from './parameters'
import { createContract } from './validate'

type ObjectMap = Record<string, unknown>
export type OpenApiSecurityRequirement = Record<string, string[]>

export interface OpenApiSecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect'
  name?: string
  in?: 'query' | 'header' | 'cookie'
  scheme?: string
  bearerFormat?: string
}

export interface OpenApiOperation {
  method: string
  path: string
  operationId?: string
  requestRequired: boolean
  requestBody?: JsonSchema
  requestBodyContentType?: string
  parameters?: OpenApiParameter[]
  security?: OpenApiSecurityRequirement[]
  securitySchemes?: Record<string, OpenApiSecurityScheme>
  responses: Record<string, Record<string, JsonSchema>>
}

function object(value: unknown): ObjectMap {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectMap : {}
}

function securityRequirements(value: unknown): OpenApiSecurityRequirement[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    throw new TypeError('OpenAPI security must be an array of requirement objects.')
  }
  return value.map((requirement) => {
    const item = object(requirement)
    return Object.fromEntries(Object.entries(item).map(([name, scopes]) => {
      if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== 'string')) {
        throw new TypeError(`OpenAPI security scopes for ${name} must be an array of strings.`)
      }
      return [name, [...scopes]]
    }))
  })
}

function securitySchemes(value: unknown): Record<string, OpenApiSecurityScheme> {
  const source = object(value)
  return Object.fromEntries(Object.entries(source).map(([name, raw]) => {
    const scheme = object(raw)
    const type = scheme['type']
    if (!['apiKey', 'http', 'oauth2', 'openIdConnect'].includes(String(type))) {
      throw new TypeError(`Unsupported OpenAPI security scheme: ${name}`)
    }
    if (type === 'apiKey' && (typeof scheme['name'] !== 'string' || !['query', 'header', 'cookie'].includes(String(scheme['in'])))) {
      throw new TypeError(`API key security scheme ${name} requires name and in.`)
    }
    if (type === 'http' && typeof scheme['scheme'] !== 'string') {
      throw new TypeError(`HTTP security scheme ${name} requires scheme.`)
    }
    const normalized = { type: type as OpenApiSecurityScheme['type'] } as OpenApiSecurityScheme
    if (typeof scheme['name'] === 'string') {
      normalized.name = scheme['name']
    }
    if (scheme['in'] === 'query' || scheme['in'] === 'header' || scheme['in'] === 'cookie') {
      normalized.in = scheme['in']
    }
    if (typeof scheme['scheme'] === 'string') {
      normalized.scheme = scheme['scheme']
    }
    if (typeof scheme['bearerFormat'] === 'string') {
      normalized.bearerFormat = scheme['bearerFormat']
    }
    return [name, normalized]
  }))
}

/** Normalize OpenAPI 3.0 nullable/exclusive bounds to JSON Schema 2020-12. */
function normalize(value: unknown, legacy: boolean): unknown {
  if (!value || typeof value !== 'object') {
    return value
  }
  const source = value as ObjectMap
  const result: ObjectMap = { ...source }
  // Only descend into schema positions. Examples/defaults are application data.
  for (const key of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']) {
    if (source[key] && typeof source[key] === 'object') {
      result[key] = Object.fromEntries(Object.entries(object(source[key])).map(([name, schema]) => [name, normalize(schema, legacy)]))
    }
  }
  for (const key of ['items', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else']) {
    if (key in source) {
      result[key] = normalize(source[key], legacy)
    }
  }
  for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    if (Array.isArray(source[key])) {
      result[key] = source[key].map(schema => normalize(schema, legacy))
    }
  }
  if (legacy) {
    delete result['nullable']
    for (const [exclusive, bound] of [['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum']] as const) {
      if (typeof source[exclusive] === 'boolean') {
        delete result[exclusive]
        if (source[exclusive] && typeof source[bound] === 'number') {
          result[exclusive] = source[bound]
          delete result[bound]
        }
      }
    }
    if (source['nullable'] === true) {
      return { anyOf: [result, { type: 'null' }] }
    }
  }
  return result
}

/** Import JSON request/response contracts; all references must be local. */
export function importOpenApi(document: unknown): OpenApiOperation[] {
  const spec = object(document)
  if (typeof spec['openapi'] !== 'string' || !/^3\.[01]\./.test(spec['openapi'])) {
    throw new Error('Expected an OpenAPI 3.0 or 3.1 document.')
  }
  const legacy = spec['openapi'].startsWith('3.0.')
  const components = {
    ...object(spec['components']),
    schemas: Object.fromEntries(Object.entries(object(object(spec['components'])['schemas']))
      .map(([name, value]) => [name, normalize(value, legacy)])),
  }
  const schemes = securitySchemes(object(object(spec['components'])['securitySchemes']))
  const globalSecurity = securityRequirements(spec['security'])
  const dereference = (value: unknown): ObjectMap => {
    const item = object(value)
    return typeof item['$ref'] === 'string' ? object(resolvePointer(spec, item['$ref'])) : item
  }
  const schema = (value: unknown): JsonSchema => {
    if (typeof value === 'boolean') {
      return value
    }
    return { ...object(normalize(value, legacy)), components }
  }
  const result: OpenApiOperation[] = []
  for (const [path, rawPath] of Object.entries(object(spec['paths']))) {
    const item = dereference(rawPath)
    for (const method of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
      if (!item[method]) {
        continue
      }
      const operation = object(item[method])
      const parameters = importParameters(item['parameters'], operation['parameters'], dereference, schema)
      const normalizedPath = path.replace(/\{([^}]+)\}/g, ':$1')
      compileParameters(parameters, normalizedPath)
      const request = dereference(operation['requestBody'])
      const content = object(request['content'])
      const requestMediaEntry = Object.entries(content).find(([type]) => type === 'application/json' || type === 'multipart/form-data' || type.endsWith('+json'))
      const requestMedia = object(requestMediaEntry?.[1])
      const responses: OpenApiOperation['responses'] = {}
      for (const [status, value] of Object.entries(object(operation['responses']))) {
        const responseContent = object(dereference(value)['content'])
        responses[status] = Object.fromEntries(Object.entries(responseContent)
          .filter(([, media]) => 'schema' in object(media))
          .map(([mediaType, media]) => [mediaType, schema(object(media)['schema'])]))
      }
      result.push({
        method: method.toUpperCase(),
        path: normalizedPath,
        ...(typeof operation['operationId'] === 'string' ? { operationId: operation['operationId'] } : {}),
        requestRequired: request['required'] === true,
        ...('schema' in requestMedia ? { requestBody: schema(requestMedia['schema']) } : {}),
        ...(requestMediaEntry && 'schema' in requestMedia ? { requestBodyContentType: requestMediaEntry[0] } : {}),
        ...(parameters.length ? { parameters } : {}),
        ...(Object.hasOwn(operation, 'security')
          ? (() => {
              const security = securityRequirements(operation['security'])
              return security === undefined ? {} : { security }
            })()
          : globalSecurity === undefined ? {} : { security: globalSecurity }),
        ...(Object.keys(schemes).length ? { securitySchemes: schemes } : {}),
        responses,
      })
    }
  }
  return result
}

function scalarText(value: ParameterScalar): string {
  return value === null ? 'null' : String(value)
}

function encodeParameter(value: ParameterScalar): string {
  return encodeURIComponent(scalarText(value))
}

function objectEntries(value: ParameterObject): Array<[string, ParameterScalar]> {
  return Object.entries(value).flatMap(([name, item]) => Array.isArray(item)
    ? item.map(entry => [name, entry] as [string, ParameterScalar])
    : [[name, item] as [string, ParameterScalar]])
}

interface SerializedParameter {
  path?: string
  query: Array<[string, string]>
  header?: [string, string]
  cookie: Array<[string, string]>
}

function serializeParameter(parameter: OpenApiParameter, value: ParameterValue): SerializedParameter {
  const style = parameter.style ?? (parameter.in === 'query' || parameter.in === 'cookie' ? 'form' : 'simple')
  const explode = parameter.explode ?? (style === 'form' || style === 'deepObject')
  const query: Array<[string, string]> = []
  const cookie: Array<[string, string]> = []
  const target = parameter.in === 'query' ? query : parameter.in === 'cookie' ? cookie : undefined
  const add = (name: string, item: ParameterScalar, destination = target) => {
    if (!destination) {
      return
    }
    destination.push(parameter.in === 'query'
      ? [encodeParameter(name), encodeParameter(item)]
      : [name, scalarText(item)])
  }
  const addSerialized = (name: string, serialized: string, destination = target) => {
    if (!destination) {
      return
    }
    destination.push(parameter.in === 'query' ? [encodeParameter(name), serialized] : [name, serialized])
  }
  const encoded = (item: ParameterScalar) => encodeParameter(item)
  const array = Array.isArray(value) ? value : undefined
  const object = !array && value !== null && typeof value === 'object' ? value as ParameterObject : undefined
  if (parameter.in === 'path') {
    if (array) {
      if (style === 'label') {
        return { path: `.${array.map(encoded).join('.')}`, query, cookie }
      }
      if (style === 'matrix') {
        return { path: explode ? array.map(item => `;${parameter.name}=${encoded(item)}`).join('') : `;${parameter.name}=${array.map(encoded).join(',')}`, query, cookie }
      }
      return { path: array.map(encoded).join(','), query, cookie }
    }
    if (object) {
      const entries = objectEntries(object).map(([name, item]) => `${encoded(name)}${explode ? '=' : ','}${encoded(item)}`)
      if (style === 'label') {
        return { path: `.${entries.join(explode ? '.' : ',')}`, query, cookie }
      }
      if (style === 'matrix') {
        return { path: explode ? entries.map(entry => `;${entry}`).join('') : `;${parameter.name}=${entries.join(',')}`, query, cookie }
      }
      return { path: entries.join(','), query, cookie }
    }
    const item = value as ParameterScalar
    if (style === 'label') {
      return { path: `.${encoded(item)}`, query, cookie }
    }
    if (style === 'matrix') {
      return { path: `;${parameter.name}=${encoded(item)}`, query, cookie }
    }
    return { path: encoded(item), query, cookie }
  }
  if (object) {
    const entries = objectEntries(object)
    if (explode) {
      if (parameter.in === 'header') {
        return { query, header: [parameter.name, entries.map(([name, item]) => `${name}=${scalarText(item)}`).join(',')], cookie }
      }
      for (const [name, item] of entries) {
        add(parameter.style === 'deepObject' ? `${parameter.name}[${name}]` : name, item)
      }
    }
    else {
      const valueText = entries.flatMap(([name, item]) => [name, scalarText(item)]).join(',')
      if (parameter.in === 'header') {
        return { query, header: [parameter.name, valueText], cookie }
      }
      addSerialized(parameter.name, parameter.in === 'query'
        ? entries.flatMap(([name, item]) => [encoded(name), encoded(item)]).join(',')
        : valueText)
    }
    return { query, cookie }
  }
  if (array) {
    if (parameter.in === 'header') {
      return { query, header: [parameter.name, array.map(scalarText).join(',')], cookie }
    }
    if (style === 'spaceDelimited' || style === 'pipeDelimited') {
      addSerialized(parameter.name, parameter.in === 'query'
        ? array.map(encoded).join(style === 'spaceDelimited' ? '%20' : '|')
        : array.map(scalarText).join(style === 'spaceDelimited' ? ' ' : '|'))
    }
    else if (explode) {
      for (const item of array) {
        add(parameter.name, item)
      }
    }
    else {
      addSerialized(parameter.name, parameter.in === 'query' ? array.map(encoded).join(',') : array.map(scalarText).join(','))
    }
    return { query, cookie }
  }
  const item = value as ParameterScalar
  if (parameter.in === 'header') {
    return { query, header: [parameter.name, scalarText(item)], cookie }
  }
  add(parameter.name, item)
  return { query, cookie }
}

interface SecurityFixtureValues {
  headers: Record<string, string>
  query: Array<[string, string]>
  cookies: Array<[string, string]>
}

function securityFixtureValues(operation: OpenApiOperation): SecurityFixtureValues {
  const requirement = operation.security?.[0]
  if (!requirement || !operation.securitySchemes) {
    return { headers: {}, query: [], cookies: [] }
  }
  const headers: Record<string, string> = {}
  const query: Array<[string, string]> = []
  const cookies: Array<[string, string]> = []
  for (const name of Object.keys(requirement)) {
    const scheme = operation.securitySchemes[name]
    if (!scheme) {
      continue
    }
    if (scheme.type === 'apiKey' && scheme.in === 'header' && scheme.name) {
      headers[scheme.name] = 'mock-api-key'
    }
    else if (scheme.type === 'apiKey' && scheme.in === 'query' && scheme.name) {
      query.push([encodeParameter(scheme.name), encodeParameter('mock-api-key')])
    }
    else if (scheme.type === 'apiKey' && scheme.in === 'cookie' && scheme.name) {
      cookies.push([scheme.name, 'mock-api-key'])
    }
    else if (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'basic') {
      headers['authorization'] = `Basic ${btoa('mock:mock')}`
    }
    else if ((scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer') || scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
      headers['authorization'] = 'Bearer mock-token'
    }
  }
  return { headers, query, cookies }
}

function generateRequestFixture(operation: OpenApiOperation) {
  let path = operation.path
  const query: Array<[string, string]> = []
  const security = securityFixtureValues(operation)
  query.push(...security.query)
  const headers: Record<string, string> = security.headers
  const cookies: Array<[string, string]> = [...security.cookies]
  for (const parameter of operation.parameters ?? []) {
    const value = generateFixture(parameter.schema) as ParameterValue
    const serialized = serializeParameter(parameter, value)
    if (serialized.path !== undefined) {
      path = path.replace(`:${parameter.name}`, serialized.path)
    }
    query.push(...serialized.query)
    cookies.push(...serialized.cookie)
    if (serialized.header) {
      headers[serialized.header[0]] = serialized.header[1]
    }
  }
  if (cookies.length) {
    headers['cookie'] = cookies.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('; ')
  }
  if (operation.requestBody !== undefined) {
    headers['content-type'] = operation.requestBodyContentType ?? 'application/json'
  }
  if (query.length) {
    path += `?${query.map(([name, value]) => `${name}=${value}`).join('&')}`
  }
  return {
    path,
    ...(Object.keys(headers).length ? { requestHeaders: headers } : {}),
    ...(operation.requestBody !== undefined ? { requestBody: generateFixture(operation.requestBody) } : {}),
  }
}

export function generateOpenApiFixtures(document: unknown) {
  return importOpenApi(document).flatMap(operation => Object.entries(operation.responses)
    .filter(([status]) => /^\d{3}$/.test(status))
    .flatMap(([status, content]) => (Object.keys(content).length === 0
      ? [['', undefined] as const]
      : Object.entries(content))
      .filter(([mediaType]) => mediaType === '' || mediaType === 'application/json' || mediaType.endsWith('+json'))
      .map(([mediaType, schema]) => ({
        method: operation.method,
        ...generateRequestFixture(operation),
        status: Number(status),
        headers: mediaType ? { 'content-type': mediaType } : {},
        body: schema === undefined ? null : generateFixture(schema),
      }))))
}

export interface OpenApiResponseSchemaResolution {
  kind: 'schema' | 'empty' | 'missing'
  schema?: JsonSchema
  contentType?: string
}

/** Resolve the response schema selected by status and media type without compiling it. */
export function resolveOpenApiResponseSchema(
  operation: Pick<OpenApiOperation, 'responses'>,
  status: number,
  contentType: string,
): OpenApiResponseSchemaResolution {
  const content = operation.responses[String(status)]
    ?? operation.responses[`${Math.floor(status / 100)}XX`]
    ?? operation.responses['default']
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!content) {
    return { kind: 'missing', contentType: mediaType }
  }
  if (Object.keys(content).length === 0) {
    return { kind: 'empty', contentType: mediaType }
  }
  const selected = Object.entries(content).find(([candidate]) => {
    const normalized = candidate.toLowerCase()
    return normalized === mediaType
      || normalized === `${mediaType.split('/')[0]}/*`
      || normalized === '*/*'
  })
  if (!selected) {
    return { kind: 'missing', contentType: mediaType }
  }
  return { kind: 'schema', schema: selected[1], contentType: selected[0].toLowerCase() }
}

export function validateOpenApiResponse(operation: OpenApiOperation, status: number, contentType: string, body: unknown) {
  const resolution = resolveOpenApiResponseSchema(operation, status, contentType)
  if (resolution.kind === 'empty') {
    return body === undefined || body === null || body === ''
      ? { valid: true, issues: [] }
      : { valid: false, issues: [{ path: '/', keyword: 'response', message: `Expected an empty response for ${status}` }] }
  }
  if (resolution.kind === 'missing') {
    return { valid: false, issues: [{ path: '/', keyword: 'response', message: `No contract for ${status} ${resolution.contentType ?? ''}` }] }
  }
  return createContract(resolution.schema!).validate(body)
}

/** Validate a serialized request against an operation's path, query, header and cookie parameters. */
export function validateOpenApiParameters(operation: Pick<OpenApiOperation, 'parameters' | 'path'>, request: Request, cookies: Record<string, string> = {}) {
  return compileParameters(operation.parameters ?? [], operation.path)({
    request,
    cookies,
    params: {},
    requestId: 'contract-validation',
    finalize: () => undefined,
  })
}
