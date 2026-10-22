import type { JsonSchema } from './validate'
import { createContract } from './validate'

export function resolvePointer(root: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    throw new Error(`Only local schema references are supported: ${ref}`)
  }
  return ref.slice(2).split('/').reduce<unknown>((value, key) => {
    const decoded = key.replaceAll('~1', '/').replaceAll('~0', '~')
    return value && typeof value === 'object' ? (value as Record<string, unknown>)[decoded] : undefined
  }, root)
}

/** Generate a deterministic minimal fixture, validating the result before returning. */
export function generateFixture(schema: JsonSchema): unknown {
  const contract = createContract(schema)
  const root = typeof schema === 'object' ? schema : {}
  const visit = (node: unknown, depth: number): unknown => {
    if (depth > 32) {
      throw new Error('Cannot generate a finite fixture for a recursive schema; supply an example.')
    }
    if (node === true) {
      return null
    }
    if (!node || typeof node !== 'object') {
      throw new Error('Cannot generate a fixture for this schema.')
    }
    const item = node as Record<string, unknown>
    if ('$ref' in item) {
      return visit(resolvePointer(root, String(item['$ref'])), depth + 1)
    }
    for (const key of ['const', 'example', 'default']) {
      if (key in item) {
        return structuredClone(item[key])
      }
    }
    for (const key of ['examples', 'enum']) {
      if (Array.isArray(item[key]) && item[key].length > 0) {
        return structuredClone(item[key][0])
      }
    }
    const alternatives = item['oneOf'] ?? item['anyOf']
    if (Array.isArray(alternatives)) {
      return visit(alternatives[0], depth + 1)
    }
    if (Array.isArray(item['allOf'])) {
      const values = item['allOf'].map(part => visit(part, depth + 1))
      if (values.every(value => value && typeof value === 'object' && !Array.isArray(value))) {
        return Object.assign({}, ...values)
      }
      return values[0]
    }
    const type = Array.isArray(item['type']) ? item['type'][0] : item['type']
    if (type === 'object' || item['properties']) {
      const properties = (item['properties'] ?? {}) as Record<string, unknown>
      const required = new Set(Array.isArray(item['required']) ? item['required'] : [])
      return Object.fromEntries(Object.entries(properties)
        .filter(([key]) => required.has(key))
        .map(([key, value]) => [key, visit(value, depth + 1)]))
    }
    if (type === 'array') {
      const length = typeof item['minItems'] === 'number' ? item['minItems'] : 0
      if (length > 1000) {
        throw new Error('Fixture array exceeds 1000 entries; provide a smaller example.')
      }
      return Array.from({ length }, () => visit(item['items'] ?? true, depth + 1))
    }
    if (type === 'boolean') {
      return false
    }
    if (type === 'null' || !type) {
      return null
    }
    if (type === 'number' || type === 'integer') {
      const minimum = typeof item['minimum'] === 'number' ? item['minimum'] : 0
      const exclusive = item['exclusiveMinimum']
      let value = typeof exclusive === 'number' ? Math.max(minimum, exclusive + 1) : minimum
      if (typeof item['maximum'] === 'number') {
        value = Math.min(value, item['maximum'])
      }
      if (typeof item['exclusiveMaximum'] === 'number') {
        value = Math.min(value, item['exclusiveMaximum'] - 1)
      }
      if (type === 'integer') {
        value = Math.ceil(value)
      }
      if (typeof item['multipleOf'] === 'number') {
        value = Math.ceil(value / item['multipleOf']) * item['multipleOf']
      }
      return value
    }
    const formats: Record<string, string> = {
      'date-time': '2020-01-01T00:00:00.000Z',
      'date': '2020-01-01',
      'email': 'mock@example.com',
      'uuid': '00000000-0000-4000-8000-000000000000',
      'uri': 'https://example.com/',
      'hostname': 'example.com',
      'ipv4': '127.0.0.1',
      'ipv6': '::1',
    }
    if (typeof item['format'] === 'string' && formats[item['format']]) {
      return formats[item['format']]
    }
    const length = typeof item['minLength'] === 'number' ? item['minLength'] : 0
    if (length > 10000) {
      throw new Error('Fixture string exceeds 10000 characters; provide an example.')
    }
    return 'x'.repeat(length)
  }
  return contract.parse(visit(schema, 0))
}
