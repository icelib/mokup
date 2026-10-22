import type { ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import Ajv from 'ajv/dist/2020.js'

export type JsonSchema = boolean | Record<string, unknown>
export interface ContractIssue {
  path: string
  keyword: string
  message: string
}

export class ContractError extends Error {
  readonly issues: ContractIssue[]

  constructor(issues: ContractIssue[]) {
    super(issues.map(issue => `${issue.path || '/'}: ${issue.message}`).join('; '))
    this.name = 'ContractError'
    this.issues = issues
  }
}

/** Compile locally, without fetching schemas, coercing, or mutating payloads. */
export function createContract<T = unknown>(schema: JsonSchema) {
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true })
  addFormats(ajv)
  const validate = ajv.compile<T>(schema)
  const issues = (errors: ErrorObject[] | null | undefined): ContractIssue[] =>
    (errors ?? []).map(error => ({
      path: error.instancePath,
      keyword: error.keyword,
      message: error.message ?? 'Invalid value',
    }))
  return {
    validate(value: unknown): { valid: boolean, issues: ContractIssue[] } {
      const valid = validate(value)
      return { valid, issues: issues(validate.errors) }
    },
    parse(value: unknown): T {
      if (!validate(value)) {
        throw new ContractError(issues(validate.errors))
      }
      return value
    },
  }
}
