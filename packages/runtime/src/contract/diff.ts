import type { OpenApiOperation } from './openapi'
import type { ContractIssue, JsonSchema } from './validate'
import { resolveOpenApiResponseSchema } from './openapi'
import { createContract } from './validate'

export type ContractResponseDifferenceKind = 'added' | 'removed' | 'changed' | 'invalid'

export interface ContractResponseDifference {
  /** JSON Pointer into the response value; `/` is used for a root or contract issue. */
  path: string
  kind: ContractResponseDifferenceKind
  side?: 'expected' | 'actual'
  expected?: unknown
  actual?: unknown
  keyword?: string
  message?: string
}

export interface ContractResponseValidation {
  valid: boolean
  issues: ContractIssue[]
}

export interface ContractResponseDiff {
  equal: boolean
  expected: ContractResponseValidation
  actual: ContractResponseValidation
  differences: ContractResponseDifference[]
  truncated: boolean
}

export interface ContractResponseDiffOptions {
  /** Maximum contract and value differences retained. Defaults to 100. */
  maxDifferences?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function pointer(value: string, key: string) {
  return `${value}/${key.replace(/~/gu, '~0').replace(/\//gu, '~1')}`
}

/** Compare two JSON-compatible values while preserving RFC 6901 paths. */
function compareValues(
  expected: unknown,
  actual: unknown,
  maxDifferences: number,
  differences: ContractResponseDifference[],
): boolean {
  const pending: Array<{ path: string, expected: unknown, actual: unknown, kind: Exclude<ContractResponseDifferenceKind, 'invalid'> }> = [
    { path: '', expected, actual, kind: 'changed' },
  ]
  let truncated = false
  while (pending.length) {
    const entry = pending.pop()!
    if (Object.is(entry.expected, entry.actual)) {
      continue
    }
    if (entry.kind === 'changed' && isRecord(entry.expected) && isRecord(entry.actual)
      && Array.isArray(entry.expected) === Array.isArray(entry.actual)) {
      const keys = [...new Set([...Object.keys(entry.expected), ...Object.keys(entry.actual)])].sort().reverse()
      for (const key of keys) {
        const expectedPresent = Object.hasOwn(entry.expected, key)
        const actualPresent = Object.hasOwn(entry.actual, key)
        pending.push({
          path: pointer(entry.path, key),
          expected: expectedPresent ? entry.expected[key] : undefined,
          actual: actualPresent ? entry.actual[key] : undefined,
          kind: !expectedPresent ? 'added' : !actualPresent ? 'removed' : 'changed',
        })
      }
      continue
    }
    if (differences.length >= maxDifferences) {
      truncated = true
      break
    }
    differences.push({
      path: entry.path || '/',
      kind: entry.kind,
      ...(entry.kind === 'added' ? {} : { expected: entry.expected }),
      ...(entry.kind === 'removed' ? {} : { actual: entry.actual }),
    })
  }
  return truncated
}

function addIssues(
  differences: ContractResponseDifference[],
  side: 'expected' | 'actual',
  issues: ContractIssue[],
  maxDifferences: number,
) {
  let truncated = false
  for (const issue of issues) {
    if (differences.length >= maxDifferences) {
      truncated = true
      break
    }
    differences.push({
      path: issue.path || '/',
      kind: 'invalid',
      side,
      keyword: issue.keyword,
      message: issue.message,
    })
  }
  return truncated
}

function validationFor(
  operation: OpenApiOperation,
  status: number,
  contentType: string,
  body: unknown,
): ContractResponseValidation {
  const resolution = resolveOpenApiResponseSchema(operation, status, contentType)
  if (resolution.kind === 'empty') {
    return body === undefined || body === null || body === ''
      ? { valid: true, issues: [] }
      : { valid: false, issues: [{ path: '/', keyword: 'response', message: `Expected an empty response for ${status}` }] }
  }
  if (resolution.kind === 'missing') {
    return { valid: false, issues: [{ path: '/', keyword: 'response', message: `No contract for ${status} ${resolution.contentType ?? ''}` }] }
  }
  return createContract(resolution.schema as JsonSchema).validate(body)
}

/** Compare two response values and report both structural changes and schema violations. */
export function diffOpenApiResponse(
  operation: OpenApiOperation,
  status: number,
  contentType: string,
  expected: unknown,
  actual: unknown,
  options: ContractResponseDiffOptions = {},
): ContractResponseDiff {
  const maxDifferences = options.maxDifferences ?? 100
  if (!Number.isSafeInteger(maxDifferences) || maxDifferences < 1) {
    throw new RangeError('Contract comparison maxDifferences must be a positive safe integer.')
  }
  const expectedValidation = validationFor(operation, status, contentType, expected)
  const actualValidation = validationFor(operation, status, contentType, actual)
  const differences: ContractResponseDifference[] = []
  const expectedTruncated = addIssues(differences, 'expected', expectedValidation.issues, maxDifferences)
  const actualTruncated = !expectedTruncated && addIssues(differences, 'actual', actualValidation.issues, maxDifferences)
  const valueTruncated = !expectedTruncated && !actualTruncated
    ? compareValues(expected, actual, maxDifferences, differences)
    : false
  return {
    equal: differences.length === 0,
    expected: expectedValidation,
    actual: actualValidation,
    differences,
    truncated: expectedTruncated || actualTruncated || valueTruncated,
  }
}
