import type { OpenApiParameter, ParameterLocation, ParameterStyle } from './parameters'
import type { JsonSchema } from './validate'

type ObjectMap = Record<string, unknown>

/** Operation parameters override path-item parameters with the same name/location. */
export function importParameters(
  pathParameters: unknown,
  operationParameters: unknown,
  dereference: (input: unknown) => ObjectMap,
  schema: (input: unknown) => JsonSchema,
): OpenApiParameter[] {
  const merged = new Map<string, OpenApiParameter>()
  for (const group of [pathParameters, operationParameters]) {
    if (group === undefined) {
      continue
    }
    if (!Array.isArray(group)) {
      throw new TypeError('OpenAPI parameters must be an array.')
    }
    const names = new Set<string>()
    for (const input of group) {
      const parameter = dereference(input)
      if (typeof parameter['name'] !== 'string' || !parameter['name']
        || !['query', 'header', 'path', 'cookie'].includes(String(parameter['in']))) {
        throw new TypeError('OpenAPI parameters require a name and a supported location.')
      }
      const location = parameter['in'] as ParameterLocation
      const name = location === 'header' ? parameter['name'].toLowerCase() : parameter['name']
      // OpenAPI explicitly excludes these header definitions; security/content metadata use other fields.
      if (location === 'header' && ['accept', 'content-type', 'authorization'].includes(name)) {
        continue
      }
      if (!Object.hasOwn(parameter, 'schema') || 'content' in parameter || parameter['allowReserved'] === true) {
        throw new TypeError('Parameters require a schema; content and allowReserved serialization are not supported.')
      }
      const key = `${location}:${name}`
      if (names.has(key)) {
        throw new TypeError('Duplicate OpenAPI parameter within a path item or operation.')
      }
      names.add(key)
      const supportedStyles = location === 'query'
        ? ['form', 'spaceDelimited', 'pipeDelimited', 'deepObject']
        : location === 'path'
          ? ['simple', 'label', 'matrix']
          : location === 'header'
            ? ['simple']
            : ['form']
      const style = parameter['style'] ?? (location === 'query' || location === 'cookie' ? 'form' : 'simple')
      if (typeof style !== 'string' || !supportedStyles.includes(style)) {
        throw new TypeError('Unsupported OpenAPI parameter style for this location.')
      }
      const normalizedStyle = style as ParameterStyle
      if (parameter['required'] !== undefined && typeof parameter['required'] !== 'boolean') {
        throw new TypeError('Parameter required must be a boolean.')
      }
      if (parameter['allowEmptyValue'] !== undefined && (typeof parameter['allowEmptyValue'] !== 'boolean' || location !== 'query')) {
        throw new TypeError('Parameter allowEmptyValue is a query-only boolean option.')
      }
      if (parameter['explode'] !== undefined && typeof parameter['explode'] !== 'boolean') {
        throw new TypeError('Parameter explode must be a boolean.')
      }
      if (location === 'path' && parameter['required'] !== true) {
        throw new TypeError('OpenAPI path parameters must be required.')
      }
      const parameterSchema = schema(parameter['schema'])
      const schemaType = typeof parameterSchema === 'object' && parameterSchema !== null && !Array.isArray(parameterSchema)
        ? parameterSchema['type']
        : undefined
      if (style === 'deepObject' && schemaType !== 'object') {
        throw new TypeError('deepObject parameters require an object schema.')
      }
      if ((style === 'spaceDelimited' || style === 'pipeDelimited') && schemaType !== 'array') {
        throw new TypeError(`${style} parameters require an array schema.`)
      }
      merged.set(key, {
        name,
        in: location,
        required: parameter['required'] === true,
        schema: parameterSchema,
        style: normalizedStyle,
        explode: parameter['explode'] as boolean | undefined ?? (style === 'form' || style === 'deepObject'),
        ...(parameter['allowEmptyValue'] === undefined ? {} : { allowEmptyValue: parameter['allowEmptyValue'] === true }),
      })
    }
  }
  return [...merged.values()]
}
