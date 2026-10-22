import type { JsonSchema } from './validate'

function literal(value: unknown): string {
  if (value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(literal).join(', ')}]`
  }
  if (value && typeof value === 'object') {
    return `{ ${Object.entries(value).map(([key, child]) => `${JSON.stringify(key)}: ${literal(child)}`).join('; ')} }`
  }
  return 'unknown'
}

/** Conservative structural TypeScript types. Runtime validation still enforces schema constraints. */
export function schemaToTypeScript(schema: JsonSchema): string {
  const root = typeof schema === 'object' ? schema : {}
  const visit = (input: unknown, depth: number, refs: ReadonlySet<string>): string => {
    if (input === false) {
      return 'never'
    }
    if (depth > 32 || input === true || !input || typeof input !== 'object') {
      return 'unknown'
    }
    const node = input as Record<string, unknown>
    if (typeof node['$ref'] === 'string') {
      const ref = node['$ref']
      if (!ref.startsWith('#/') || refs.has(ref)) {
        return 'unknown'
      }
      let target: unknown = root
      for (const segment of ref.slice(2).split('/')) {
        const key = segment.replace(/~1/gu, '/').replace(/~0/gu, '~')
        if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) {
          return 'unknown'
        }
        target = (target as Record<string, unknown>)[key]
      }
      return visit(target, depth + 1, new Set([...refs, ref]))
    }
    if (['not', 'if', 'then', 'else', 'dependentSchemas', 'prefixItems', 'patternProperties'].some(key => key in node)) {
      return 'unknown'
    }
    if ('const' in node) {
      return literal(node['const'])
    }
    if (Array.isArray(node['enum'])) {
      return node['enum'].length ? node['enum'].map(literal).join(' | ') : 'never'
    }
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(node[key])) {
        return node[key].map(child => `(${visit(child, depth + 1, refs)})`).join(key === 'allOf' ? ' & ' : ' | ') || 'unknown'
      }
    }
    if (Array.isArray(node['type'])) {
      return node['type'].map(type => visit({ ...node, type }, depth + 1, refs)).join(' | ') || 'unknown'
    }
    const type = node['type']
    if (type === 'integer' || type === 'number') {
      return 'number'
    }
    if (type === 'string' || type === 'boolean' || type === 'null') {
      return type
    }
    if (type === 'array') {
      return `Array<${visit(node['items'] ?? true, depth + 1, refs)}>`
    }
    if (type === 'object' || node['properties']) {
      const properties = node['properties'] && typeof node['properties'] === 'object'
        ? node['properties'] as Record<string, unknown>
        : {}
      const required = new Set(Array.isArray(node['required']) ? node['required'].filter(value => typeof value === 'string') : [])
      const names = new Set([...Object.keys(properties), ...required])
      const members = [...names].map(name => `${JSON.stringify(name)}${required.has(name) ? '' : '?'}: ${visit(properties[name] ?? true, depth + 1, refs)}`)
      if (!members.length) {
        return node['additionalProperties'] === false ? 'Record<string, never>' : 'Record<string, unknown>'
      }
      if (node['additionalProperties'] !== false) {
        members.push('[key: string]: unknown')
      }
      return `{ ${members.join('; ')} }`
    }
    return 'unknown'
  }
  return visit(schema, 0, new Set())
}
