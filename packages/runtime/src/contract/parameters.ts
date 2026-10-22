import type { HttpResolverContext } from '../http/types'
import type { ContractIssue, JsonSchema } from './validate'
import { createContract } from './validate'

export type ParameterLocation = 'query' | 'header' | 'path' | 'cookie'
export type ParameterScalar = string | number | boolean
export type ParameterObject = Record<string, ParameterScalar | ParameterScalar[]>
export type ParameterValue = ParameterScalar | ParameterScalar[] | ParameterObject
export type ContractParameters = Record<ParameterLocation, Record<string, ParameterValue | undefined>>

export type ParameterStyle = 'form' | 'simple' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject' | 'label' | 'matrix'

export interface OpenApiParameter {
  name: string
  in: ParameterLocation
  required: boolean
  schema: JsonSchema
  style?: ParameterStyle
  explode?: boolean
  allowEmptyValue?: boolean
}

type ScalarType = 'string' | 'number' | 'integer' | 'boolean'

function effectiveSchema(value: unknown, root: JsonSchema, references = new Set<string>()): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Contract parameters require an explicit scalar or scalar-array schema.')
  }
  const schema = value as Record<string, unknown>
  if (typeof schema['$ref'] !== 'string') {
    return schema
  }
  const ref = schema['$ref']
  if (!ref.startsWith('#/') || references.has(ref)) {
    throw new TypeError('Parameter schemas support only finite local references.')
  }
  let target: unknown = root
  for (const part of ref.slice(2).split('/')) {
    const key = part.replace(/~1/gu, '/').replace(/~0/gu, '~')
    if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) {
      throw new TypeError('Parameter schema reference does not exist.')
    }
    target = (target as Record<string, unknown>)[key]
  }
  const { $ref: _reference, ...siblings } = schema
  return { ...effectiveSchema(target, root, new Set([...references, ref])), ...siblings }
}

function scalarType(schema: Record<string, unknown>): ScalarType {
  if (typeof schema['type'] !== 'string' || !['string', 'number', 'integer', 'boolean'].includes(schema['type'])) {
    throw new TypeError('Contract parameters support string, number, integer, boolean, or arrays of these types.')
  }
  return schema['type'] as ScalarType
}

function scalar(value: string, type: ScalarType): ParameterScalar {
  if (type === 'string') {
    return value
  }
  if (type === 'boolean') {
    if (value !== 'true' && value !== 'false') {
      throw new TypeError('Expected true or false.')
    }
    return value === 'true'
  }
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(value) || !Number.isFinite(Number(value))) {
    throw new TypeError('Expected a finite decimal number.')
  }
  const number = Number(value)
  if (type === 'integer' && !Number.isSafeInteger(number)) {
    throw new TypeError('Expected a safe integer.')
  }
  return number
}

function decode(value: string): string {
  return decodeURIComponent(value.replace(/\+/gu, ' '))
}

interface RawEntry {
  name: string
  value: string
}

function rawEntries(value: string, separator: string): RawEntry[] {
  if (!value) {
    return []
  }
  return value.split(separator).map((part) => {
    const index = part.indexOf('=')
    return { name: decode(index < 0 ? part : part.slice(0, index)), value: index < 0 ? '' : part.slice(index + 1) }
  })
}

function queryEntries(url: URL): RawEntry[] {
  return rawEntries(url.search.slice(1), '&')
}

function cookieEntries(context: HttpResolverContext): RawEntry[] {
  const header = context.request.headers.get('cookie')
  if (header !== null) {
    return rawEntries(header, ';').map(entry => ({ ...entry, name: entry.name.trim(), value: entry.value.trim() }))
  }
  // Context cookies may come from a transport that already decoded the header.
  // Re-encode them so the same parser can safely decode exactly once below.
  return Object.entries(context.cookies).map(([name, value]) => ({ name, value: encodeURIComponent(value) }))
}

function pathSegment(url: URL, path: string, name: string): string | undefined {
  const index = path.split('/').indexOf(`:${name}`)
  return index < 0 ? undefined : url.pathname.split('/')[index]
}

function splitRaw(value: string, separator: string): string[] {
  return value.split(separator).map(decode)
}

function splitDelimitedRaw(value: string, separator: 'space' | 'pipe'): string[] {
  const pattern = separator === 'space' ? /(?:%20|\+)/gu : /(?:\||%7(?:c|C))/gu
  return value.split(pattern).map(decode)
}

function objectProperties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const properties = schema['properties']
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return Object.create(null) as Record<string, Record<string, unknown>>
  }
  return Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, effectiveSchema(value, schema)]))
}

function propertyArray(schema: Record<string, unknown>): boolean {
  return schema['type'] === 'array'
}

function assignObjectValue(target: ParameterObject, name: string, value: string, schema: Record<string, unknown> | undefined): void {
  if (schema && propertyArray(schema)) {
    const current = target[name]
    const values = Array.isArray(current) ? current : current === undefined ? [] : [current]
    values.push(value)
    target[name] = values
  }
  else {
    target[name] = value
  }
}

function parseObjectPairs(tokens: string[], schema: Record<string, unknown>, pairSeparator: 'comma' | 'equals' = 'comma'): ParameterObject {
  const properties = objectProperties(schema)
  const result: ParameterObject = Object.create(null) as ParameterObject
  if (pairSeparator === 'equals') {
    for (const token of tokens) {
      const index = token.indexOf('=')
      if (index < 1) {
        throw new TypeError('Object parameter entries require a name and value.')
      }
      assignObjectValue(result, token.slice(0, index), token.slice(index + 1), properties[token.slice(0, index)])
    }
    return result
  }
  if (tokens.length % 2 !== 0) {
    throw new TypeError('Object parameter entries require name/value pairs.')
  }
  for (let index = 0; index < tokens.length; index += 2) {
    const name = tokens[index]!
    assignObjectValue(result, name, tokens[index + 1]!, properties[name])
  }
  return result
}

function parseDeepObject(entries: RawEntry[], parameterName: string, schema: Record<string, unknown>): ParameterObject {
  const result: ParameterObject = Object.create(null) as ParameterObject
  const properties = objectProperties(schema)
  const prefix = `${parameterName}[`
  for (const entry of entries) {
    if (!entry.name.startsWith(prefix) || !entry.name.endsWith(']')) {
      continue
    }
    const name = entry.name.slice(prefix.length, -1)
    if (!name) {
      throw new TypeError('Deep object parameter property names cannot be empty.')
    }
    assignObjectValue(result, name, decode(entry.value), properties[name])
  }
  return result
}

function rawValues(entries: RawEntry[], name: string): string[] {
  return entries.filter(entry => entry.name === name).map(entry => entry.value)
}

function sourceValue(parameter: OpenApiParameter, context: HttpResolverContext, url: URL, path: string, kind: 'scalar' | 'array' | 'object', explode: boolean): string[] | ParameterObject {
  const style = parameter.style ?? (parameter.in === 'query' || parameter.in === 'cookie' ? 'form' : 'simple')
  const entries = parameter.in === 'query' ? queryEntries(url) : parameter.in === 'cookie' ? cookieEntries(context) : []
  if (parameter.in === 'query' && style === 'deepObject') {
    return parseDeepObject(entries, parameter.name, effectiveSchema(parameter.schema, parameter.schema))
  }
  if (parameter.in === 'query' || parameter.in === 'cookie') {
    const values = rawValues(entries, parameter.name)
    if (kind === 'object') {
      if (explode) {
        const schema = effectiveSchema(parameter.schema, parameter.schema)
        const properties = objectProperties(schema)
        const result: ParameterObject = Object.create(null) as ParameterObject
        const names = Object.keys(properties).length
          ? Object.keys(properties)
          : schema['additionalProperties'] !== false
            ? [...new Set(entries.map(entry => entry.name))]
            : []
        for (const name of names) {
          const property = properties[name]
          for (const value of rawValues(entries, name)) {
            for (const item of property && propertyArray(property) ? splitRaw(value, ',') : [decode(value)]) {
              assignObjectValue(result, name, item, property)
            }
          }
        }
        return result
      }
      if (values.length > 1) {
        throw new TypeError('A non-exploded parameter must appear once.')
      }
      return values.length ? parseObjectPairs(splitRaw(values[0]!, ','), effectiveSchema(parameter.schema, parameter.schema)) : Object.create(null) as ParameterObject
    }
    if (kind === 'array') {
      if (style === 'spaceDelimited' || style === 'pipeDelimited') {
        if (values.length > 1) {
          throw new TypeError('A delimited parameter must appear once.')
        }
        return values.length ? splitDelimitedRaw(values[0]!, style === 'spaceDelimited' ? 'space' : 'pipe') : []
      }
      if (explode) {
        return values.map(decode)
      }
      if (values.length > 1) {
        throw new TypeError('A non-exploded parameter must appear once.')
      }
      return values.length ? splitRaw(values[0]!, ',') : []
    }
    return values.map(decode)
  }
  const raw = parameter.in === 'header'
    ? context.request.headers.get(parameter.name) ?? undefined
    : pathSegment(url, path, parameter.name)
  if (raw === undefined) {
    return kind === 'object' ? Object.create(null) as ParameterObject : []
  }
  if (parameter.in === 'header') {
    if (kind === 'object') {
      const schema = effectiveSchema(parameter.schema, parameter.schema)
      return parseObjectPairs(raw.split(',').map(value => value.trim()), schema, explode ? 'equals' : 'comma')
    }
    return kind === 'array' ? raw.split(',').map(value => value.trim()) : [raw]
  }
  if (style === 'label') {
    const value = raw.startsWith('.') ? raw.slice(1) : raw
    if (kind === 'object') {
      const schema = effectiveSchema(parameter.schema, parameter.schema)
      return parseObjectPairs(value.split('.').map(decode), schema, explode ? 'equals' : 'comma')
    }
    return kind === 'array' ? splitRaw(value, '.') : [decode(value)]
  }
  if (style === 'matrix') {
    const parts = raw.split(';').filter(Boolean)
    if (kind === 'object') {
      const schema = effectiveSchema(parameter.schema, parameter.schema)
      if (explode) {
        return parseObjectPairs(parts.map(part => part.includes('=') ? `${part.slice(0, part.indexOf('='))}=${decode(part.slice(part.indexOf('=') + 1))}` : part), schema, 'equals')
      }
      const value = parts.find(part => part.startsWith(`${parameter.name}=`))?.slice(parameter.name.length + 1)
      return value === undefined ? Object.create(null) as ParameterObject : parseObjectPairs(splitRaw(value, ','), schema)
    }
    if (explode) {
      const values = parts.filter(part => part.startsWith(`${parameter.name}=`)).map(part => part.slice(parameter.name.length + 1))
      return kind === 'array' ? values.map(decode) : values.length ? [decode(values[0]!)] : []
    }
    const value = parts.find(part => part.startsWith(`${parameter.name}=`))?.slice(parameter.name.length + 1)
    return value === undefined ? [] : kind === 'array' ? splitRaw(value, ',') : [decode(value)]
  }
  if (kind === 'object') {
    const schema = effectiveSchema(parameter.schema, parameter.schema)
    return parseObjectPairs(splitRaw(raw, ','), schema, explode ? 'equals' : 'comma')
  }
  return kind === 'array' ? splitRaw(raw, ',') : [decode(raw)]
}

function coerceObject(value: ParameterObject, schema: Record<string, unknown>): ParameterObject {
  const properties = objectProperties(schema)
  const result: ParameterObject = Object.create(null) as ParameterObject
  for (const [name, raw] of Object.entries(value)) {
    const property = properties[name]
    if (!property) {
      result[name] = raw
      continue
    }
    const propertySchema = propertyArray(property) ? effectiveSchema(property['items'], schema) : property
    const type = scalarType(propertySchema)
    result[name] = Array.isArray(raw)
      ? raw.map(item => scalar(String(item), type))
      : scalar(String(raw), type)
  }
  return result
}

function sourceIsEmpty(source: string[] | ParameterObject): boolean {
  return Array.isArray(source) ? source.length === 0 : Object.keys(source).length === 0
}

function sourceHasEmpty(source: string[] | ParameterObject): boolean {
  return Array.isArray(source)
    ? source.includes('')
    : Object.values(source).some(value => Array.isArray(value) ? value.includes('') : value === '')
}

/** Compile supported parameter serialization and JSON Schema constraints once per handler. */
export function compileParameters(parameters: readonly OpenApiParameter[], path: string) {
  const names = new Set<string>()
  const compiled = parameters.map((parameter) => {
    if (!['query', 'header', 'path', 'cookie'].includes(parameter.in) || !parameter.name || typeof parameter.required !== 'boolean') {
      throw new TypeError('Invalid parameter location or name.')
    }
    const name = parameter.in === 'header' ? parameter.name.toLowerCase() : parameter.name
    if (parameter.in === 'header') {
      new Headers().set(name, '')
    }
    const key = `${parameter.in}:${name}`
    if (names.has(key)) {
      throw new TypeError('Duplicate contract parameter.')
    }
    names.add(key)
    const style = parameter.style ?? (parameter.in === 'query' || parameter.in === 'cookie' ? 'form' : 'simple')
    const schema = effectiveSchema(parameter.schema, parameter.schema)
    const kind: 'scalar' | 'array' | 'object' = schema['type'] === 'array' ? 'array' : schema['type'] === 'object' ? 'object' : 'scalar'
    const explode = parameter.explode ?? (style === 'form' || style === 'deepObject')
    const allowed = parameter.in === 'query'
      ? ['form', 'spaceDelimited', 'pipeDelimited', 'deepObject']
      : parameter.in === 'path'
        ? ['simple', 'label', 'matrix']
        : parameter.in === 'header'
          ? ['simple']
          : ['form']
    if (!allowed.includes(style)) {
      throw new TypeError('Unsupported OpenAPI parameter style for this location.')
    }
    if (style === 'spaceDelimited' || style === 'pipeDelimited') {
      if (kind !== 'array' || explode) {
        throw new TypeError(`${style} parameters require an array schema and explode: false.`)
      }
    }
    if (style === 'deepObject' && kind !== 'object') {
      throw new TypeError('deepObject parameters require an object schema.')
    }
    if (parameter.in === 'path' && (!parameter.required || !path.split('/').includes(`:${name}`))) {
      throw new TypeError('Path parameters must be required and occupy a complete named path segment.')
    }
    const type = kind === 'array' ? scalarType(effectiveSchema(schema['items'], parameter.schema)) : kind === 'scalar' ? scalarType(schema) : undefined
    if (kind === 'array' && parameter.in === 'cookie' && explode) {
      throw new TypeError('Cookie array parameters require explode: false.')
    }
    const contract = createContract<ParameterValue>(parameter.schema)
    const hasDefault = Object.hasOwn(schema, 'default')
    const defaultValue = hasDefault ? contract.parse(structuredClone(schema['default'])) : undefined
    return { parameter: { ...parameter, name, style }, kind, type, explode, contract, hasDefault, defaultValue, schema }
  })
  return (context: HttpResolverContext): { values: ContractParameters, issues: ContractIssue[] } => {
    const values: ContractParameters = { query: Object.create(null), header: Object.create(null), path: Object.create(null), cookie: Object.create(null) }
    const issues: ContractIssue[] = []
    const url = new URL(context.request.url)
    for (const entry of compiled) {
      const { parameter } = entry
      const pointer = `/parameters/${parameter.in}/${parameter.name.replace(/~/gu, '~0').replace(/\//gu, '~1')}`
      try {
        const source = sourceValue(parameter, context, url, path, entry.kind, entry.explode)
        if (sourceIsEmpty(source)) {
          if (parameter.required) {
            issues.push({ path: pointer, keyword: 'required', message: 'Required parameter is missing.' })
          }
          else if (entry.hasDefault) {
            values[parameter.in][parameter.name] = structuredClone(entry.defaultValue)
          }
          continue
        }
        if (parameter.in === 'query' && !parameter.allowEmptyValue && sourceHasEmpty(source)) {
          throw new TypeError('Empty query values require allowEmptyValue.')
        }
        const value = entry.kind === 'object'
          ? coerceObject(source as ParameterObject, entry.schema)
          : entry.kind === 'array'
            ? (source as string[]).map(value => scalar(value, entry.type!))
            : (() => {
                const values = source as string[]
                if (values.length !== 1) {
                  throw new TypeError('A scalar parameter must appear once.')
                }
                return scalar(values[0]!, entry.type!)
              })()
        const validation = entry.contract.validate(value)
        if (validation.valid) {
          values[parameter.in][parameter.name] = value
        }
        else {
          issues.push(...validation.issues.map(issue => ({ ...issue, path: `${pointer}${issue.path}` })))
        }
      }
      catch {
        issues.push({ path: pointer, keyword: 'parameter', message: 'Invalid parameter serialization or scalar value.' })
      }
    }
    return { values, issues }
  }
}
