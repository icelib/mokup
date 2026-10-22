import type { HttpHandler, HttpParamValue, HttpResolverContext } from '../http/types'
import type { MemoryStore, StoreId } from '../scenario/store'
import type { OpenApiOperation } from './openapi'
import { createContractHandler } from './handler'

/** The small storage surface needed by generated CRUD handlers. */
export interface CrudStore<RecordType extends object> {
  list: () => RecordType[]
  get: (id: StoreId) => RecordType | undefined
  create: (record: RecordType) => RecordType
  update: (id: StoreId, changes: Partial<RecordType>) => RecordType | undefined
  delete: (id: StoreId) => boolean
}

export interface ContractCrudOptions<RecordType extends object> {
  /** Field used to bind an item route parameter to a stored record. */
  idField?: keyof RecordType & string
  /** OpenAPI path parameter name. Defaults to the final `:name` token. */
  idParam?: string
  /** Generate an ID when a POST body does not provide one. */
  idFactory?: (record: RecordType) => StoreId
  /** Return a stable body for storage errors when the contract declares it. */
  onError?: (error: unknown, context: HttpResolverContext) => { status: number, body?: unknown, headers?: HeadersInit }
  /** Reject operations that are not one of the supported CRUD shapes. */
  strict?: boolean
}

export type ContractCrudSource<RecordType extends object>
  = | readonly OpenApiOperation[]
    | { operations: readonly OpenApiOperation[], store: CrudStore<RecordType> }

function isItemOperation(operation: OpenApiOperation): boolean {
  return /:[A-Za-z_][\w-]*$/u.test(operation.path)
}

function operationKind(operation: OpenApiOperation): 'list' | 'get' | 'create' | 'replace' | 'update' | 'delete' | undefined {
  const item = isItemOperation(operation)
  if (operation.method === 'GET') {
    return item ? 'get' : 'list'
  }
  if (operation.method === 'POST' && !item) {
    return 'create'
  }
  if (operation.method === 'PUT' && item) {
    return 'replace'
  }
  if (operation.method === 'PATCH' && item) {
    return 'update'
  }
  if (operation.method === 'DELETE' && item) {
    return 'delete'
  }
  return undefined
}

function finalParameter(path: string): string | undefined {
  const token = path.match(/:([A-Za-z_][\w-]*)$/u)
  return token?.[1]
}

function rawId(value: HttpParamValue | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === undefined || raw === '') {
    throw new TypeError('A CRUD item route requires a nonempty ID.')
  }
  return raw
}

function resolveId<RecordType extends object>(store: CrudStore<RecordType>, value: HttpParamValue | undefined): StoreId {
  const raw = rawId(value)
  // OpenAPI path parameters carry their declared type. Prefer the literal
  // string first so a string ID such as "2" is never silently changed to 2;
  // numeric stores still resolve through the numeric fallback.
  if (store.get(raw) !== undefined) {
    return raw
  }
  if (/^-?(?:0|[1-9]\d*)$/u.test(raw)) {
    const number = Number(raw)
    if (Number.isSafeInteger(number) && store.get(number) !== undefined) {
      return number
    }
  }
  return raw
}

function defaultIdFactory<RecordType extends object>(store: CrudStore<RecordType>, idField: keyof RecordType & string): StoreId {
  const values = store.list().map(record => record[idField])
  const numeric = values.filter(value => typeof value === 'number' && Number.isSafeInteger(value)) as number[]
  if (numeric.length === values.length && numeric.length > 0) {
    return Math.max(...numeric) + 1
  }
  if (numeric.length === values.length && numeric.length === 0) {
    return 1
  }
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function hasResponse(operation: OpenApiOperation, status: number): boolean {
  return Object.hasOwn(operation.responses, String(status))
    || Object.hasOwn(operation.responses, `${Math.floor(status / 100)}XX`)
    || Object.hasOwn(operation.responses, 'default')
}

function supportedStatus(operation: OpenApiOperation, preferred: number, fallback = 200): number {
  if (hasResponse(operation, preferred)) {
    return preferred
  }
  if (hasResponse(operation, fallback)) {
    return fallback
  }
  const candidate = Object.keys(operation.responses).find(value => /^2\d\d$/u.test(value))
  if (candidate) {
    return Number(candidate)
  }
  return preferred
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('CRUD request bodies must be JSON objects.')
  }
  return value as Record<string, unknown>
}

function isCrudStore<RecordType extends object>(value: unknown): value is CrudStore<RecordType> {
  return Boolean(value && typeof value === 'object'
    && typeof (value as CrudStore<RecordType>).list === 'function'
    && typeof (value as CrudStore<RecordType>).get === 'function'
    && typeof (value as CrudStore<RecordType>).create === 'function'
    && typeof (value as CrudStore<RecordType>).update === 'function'
    && typeof (value as CrudStore<RecordType>).delete === 'function')
}

/**
 * Generate contract-validated CRUD handlers from imported OpenAPI operations.
 *
 * The generator intentionally works with a structural store interface, so a
 * persistent plugin can be used alongside `createMemoryStore` without changing
 * route definitions. Unsupported operations are skipped by default; `strict`
 * makes an accidental non-CRUD operation fail during setup.
 */
export function createContractCrudHandlers<RecordType extends object>(
  source: readonly OpenApiOperation[],
  store: CrudStore<RecordType>,
  options?: ContractCrudOptions<RecordType>,
): HttpHandler[]
export function createContractCrudHandlers<RecordType extends object>(
  source: { operations: readonly OpenApiOperation[], store: CrudStore<RecordType> },
  options?: ContractCrudOptions<RecordType>,
): HttpHandler[]
export function createContractCrudHandlers<RecordType extends object>(
  source: ContractCrudSource<RecordType>,
  storeOrOptions?: CrudStore<RecordType> | ContractCrudOptions<RecordType>,
  optionsInput: ContractCrudOptions<RecordType> = {},
): HttpHandler[] {
  const objectSource = Array.isArray(source)
    ? undefined
    : source as { operations: readonly OpenApiOperation[], store: CrudStore<RecordType> }
  const operations: readonly OpenApiOperation[] = objectSource?.operations ?? source as readonly OpenApiOperation[]
  const store = objectSource?.store ?? (isCrudStore<RecordType>(storeOrOptions) ? storeOrOptions : undefined)
  const options = objectSource && !isCrudStore<RecordType>(storeOrOptions)
    ? storeOrOptions ?? optionsInput
    : optionsInput
  if (!store) {
    throw new TypeError('Contract CRUD handlers require a storage backend.')
  }
  const idField = options.idField ?? 'id' as keyof RecordType & string
  const idFactory = options.idFactory ?? (() => defaultIdFactory(store, idField))
  const handlers: HttpHandler[] = []
  for (const operation of operations) {
    const kind = operationKind(operation)
    if (!kind) {
      if (options.strict) {
        throw new TypeError(`Unsupported CRUD operation: ${operation.method} ${operation.path}`)
      }
      continue
    }
    const idParam = options.idParam ?? finalParameter(operation.path)
    if (kind !== 'list' && kind !== 'create' && !idParam) {
      if (options.strict) {
        throw new TypeError(`CRUD item operation has no path ID parameter: ${operation.method} ${operation.path}`)
      }
      continue
    }
    const resolver = async (context: HttpResolverContext & { body: unknown }) => {
      try {
        if (kind === 'list') {
          return { status: supportedStatus(operation, 200), body: store.list() }
        }
        if (kind === 'create') {
          const body = asRecord(context.body)
          const record = { ...body }
          if (!Object.hasOwn(record, idField)) {
            record[idField] = idFactory(record as RecordType)
          }
          return { status: supportedStatus(operation, 201), body: store.create(record as RecordType) }
        }
        const id = resolveId(store, context.params[idParam!])
        if (kind === 'get') {
          const record = store.get(id)
          return record === undefined
            ? { status: supportedStatus(operation, 404, 200), body: { error: 'not_found' } }
            : { status: supportedStatus(operation, 200), body: record }
        }
        if (kind === 'delete') {
          if (!store.delete(id)) {
            return { status: supportedStatus(operation, 404, 204), body: { error: 'not_found' } }
          }
          return { status: supportedStatus(operation, 204), body: undefined }
        }
        const changes = asRecord(context.body)
        const record = store.update(id, changes as Partial<RecordType>)
        return record === undefined
          ? { status: supportedStatus(operation, 404, 200), body: { error: 'not_found' } }
          : { status: supportedStatus(operation, 200), body: record }
      }
      catch (error) {
        if (options.onError) {
          return options.onError(error, context)
        }
        throw error
      }
    }
    handlers.push(createContractHandler(operation, resolver as never))
  }
  return handlers
}

/** Alias emphasizing that the operations came from an OpenAPI document. */
export const createOpenApiCrudHandlers = createContractCrudHandlers

/** Alias for callers that already use the contract terminology. */
export const createCrudHandlers = createContractCrudHandlers

export type { MemoryStore }
