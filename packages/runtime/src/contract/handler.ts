import type { HttpHandler, HttpResolverContext } from '../http/types'
import type { OpenApiOperation, OpenApiSecurityScheme } from './openapi'
import type { ContractParameters } from './parameters'
import type { ContractIssue } from './validate'
import { HttpResponse } from '../http/response'
import { bodyLimits, readBody } from '../recording/body'
import { compileParameters } from './parameters'
import { ContractError, createContract } from './validate'

export interface ContractReply {
  status: number
  body?: unknown
  headers?: HeadersInit
}

export type ContractResolver<RequestBody = unknown, Reply extends ContractReply = ContractReply> = (
  context: HttpResolverContext & { body: RequestBody, parameters: ContractParameters },
) => Reply | Promise<Reply>

export interface ContractHandlerOptions {
  maxBodyBytes?: number
  bodyTimeoutMs?: number
}

function jsonMime(value: string) {
  const mime = value.split(';')[0]?.trim().toLowerCase() ?? ''
  return mime === 'application/json' || mime.endsWith('+json')
}

function issue(message: string, keyword = 'body'): ContractIssue {
  return { path: '/', keyword, message }
}

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers.get(name)
  return value && value.trim() ? value.trim() : undefined
}

function cookieValue(request: Request, name: string): string | undefined {
  const source = request.headers.get('cookie') ?? ''
  for (const part of source.split(';')) {
    const separator = part.indexOf('=')
    if (separator >= 0 && part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim()
      return value || undefined
    }
  }
  return undefined
}

function satisfiesSecurityScheme(request: Request, scheme: OpenApiSecurityScheme): boolean {
  if (scheme.type === 'apiKey') {
    if (!scheme.name || !scheme.in) {
      return false
    }
    if (scheme.in === 'header') {
      return Boolean(headerValue(request, scheme.name))
    }
    if (scheme.in === 'cookie') {
      return Boolean(cookieValue(request, scheme.name))
    }
    return Boolean(new URL(request.url).searchParams.get(scheme.name)?.trim())
  }
  const authorization = headerValue(request, 'authorization')
  if (!authorization) {
    return false
  }
  if (scheme.type === 'http') {
    const name = scheme.scheme?.trim()
    if (!name || authorization.length <= name.length || authorization.slice(0, name.length).toLowerCase() !== name.toLowerCase()) {
      return false
    }
    return /\s/u.test(authorization[name.length]!) && authorization.slice(name.length).trim().length > 0
  }
  return /^Bearer\s+\S+$/iu.test(authorization)
}

function hasSecurity(operation: OpenApiOperation, request: Request): boolean {
  if (operation.security === undefined || operation.security.length === 0) {
    return true
  }
  return operation.security.some((requirement) => {
    const entries = Object.entries(requirement)
    return entries.length === 0 || entries.every(([name]) => {
      const scheme = operation.securitySchemes?.[name]
      return Boolean(scheme && satisfiesSecurityScheme(request, scheme))
    })
  })
}

function formDataObject(form: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null)
  for (const [name, value] of form.entries()) {
    const next = typeof value === 'string'
      ? value
      : { name: value.name, type: value.type, size: value.size, lastModified: value.lastModified }
    const previous = result[name]
    result[name] = previous === undefined ? next : Array.isArray(previous) ? [...previous, next] : [previous, next]
  }
  return result
}

/** Validate JSON at both sides of an HTTP handler. Request errors are 4xx; invalid mock output throws. */
export function createContractHandler<RequestBody = unknown, Reply extends ContractReply = ContractReply>(
  input: OpenApiOperation,
  resolver: ContractResolver<RequestBody, Reply>,
  options: ContractHandlerOptions = {},
): HttpHandler {
  const { maxBodyBytes } = bodyLimits(options)
  const operation = structuredClone(input)
  if (operation.requestRequired && operation.requestBody === undefined) {
    throw new TypeError('A required request body needs a JSON schema; this bridge supports JSON contracts only.')
  }
  const requestContract = operation.requestBody === undefined ? undefined : createContract(operation.requestBody)
  const validateParameters = compileParameters(operation.parameters ?? [], operation.path)
  const responses = new Map(Object.entries(operation.responses).map(([status, content]) => [
    status,
    new Map(Object.entries(content).map(([mime, schema]) => [mime.toLowerCase(), createContract(schema)])),
  ]))
  return Object.freeze({
    method: operation.method.toUpperCase(),
    matcher: operation.path,
    once: false,
    async resolver(context: HttpResolverContext) {
      if (!hasSecurity(operation, context.request)) {
        const headers = new Headers({ 'content-type': 'application/json' })
        const scheme = Object.values(operation.securitySchemes ?? {}).find(value => value.type === 'http' && value.scheme)
        if (scheme) {
          headers.set('www-authenticate', scheme.scheme!)
        }
        return HttpResponse.json({ error: 'unauthorized', message: 'A required security scheme was not satisfied.' }, { status: 401, headers })
      }
      const parameters = validateParameters(context)
      if (parameters.issues.length) {
        return HttpResponse.json({ error: 'invalid_request', issues: parameters.issues }, { status: 400 })
      }
      let body: unknown
      try {
        const contentType = context.request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
        const multipart = operation.requestBodyContentType?.toLowerCase() === 'multipart/form-data'
        if (multipart) {
          const hasBody = context.request.body !== null
          if (!hasBody) {
            if (operation.requestRequired) {
              return HttpResponse.json({ error: 'invalid_request', issues: [issue('Required request body is missing.', 'required')] }, { status: 400 })
            }
            body = undefined
          }
          else if (!contentType || !contentType.startsWith('multipart/form-data')) {
            return HttpResponse.json({ error: 'invalid_request', issues: [issue('Expected a multipart/form-data content type.', 'content-type')] }, { status: 415 })
          }
          else {
            // Bound the raw multipart payload before parsing fields and files.
            await readBody(context.request.clone(), options)
            body = formDataObject(await context.request.formData())
            const validation = requestContract?.validate(body)
            if (validation && !validation.valid) {
              return HttpResponse.json({ error: 'invalid_request', issues: validation.issues }, { status: 400 })
            }
          }
        }
        else {
          const bytes = await readBody(context.request, options)
          if (!bytes?.length) {
            if (operation.requestRequired) {
              return HttpResponse.json({ error: 'invalid_request', issues: [issue('Required request body is missing.', 'required')] }, { status: 400 })
            }
          }
          else {
            if (!jsonMime(context.request.headers.get('content-type') ?? '')) {
              return HttpResponse.json({ error: 'invalid_request', issues: [issue('Expected a JSON content type.', 'content-type')] }, { status: 415 })
            }
            body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
            const validation = requestContract?.validate(body)
            if (validation && !validation.valid) {
              return HttpResponse.json({ error: 'invalid_request', issues: validation.issues }, { status: 400 })
            }
          }
        }
      }
      catch (error) {
        context.request.signal.throwIfAborted()
        const status = error instanceof RangeError ? 413 : error instanceof SyntaxError || error instanceof TypeError ? 400 : 408
        return HttpResponse.json({ error: 'invalid_request', issues: [issue(error instanceof Error ? error.message : String(error))] }, { status })
      }
      const reply = await resolver({ ...context, body: body as RequestBody, parameters: parameters.values })
      if (!Number.isInteger(reply.status) || reply.status < 200 || reply.status > 599) {
        throw new ContractError([issue('Mock responses require an HTTP status from 200 to 599.', 'status')])
      }
      const contract = responses.get(String(reply.status))
        ?? responses.get(`${Math.floor(reply.status / 100)}XX`)
        ?? responses.get('default')
      if (!contract) {
        throw new ContractError([issue(`No response contract for status ${reply.status}.`, 'status')])
      }
      const headers = new Headers(reply.headers)
      const bodyless = [204, 205, 304].includes(reply.status) || contract.size === 0
      if (bodyless) {
        if (reply.body !== undefined && reply.body !== null) {
          throw new ContractError([issue(`Expected an empty response for ${reply.status}.`)])
        }
        headers.delete('content-length')
        headers.delete('transfer-encoding')
        return new Response(null, { status: reply.status, headers })
      }
      const contentType = headers.get('content-type') ?? [...contract.keys()].find(jsonMime) ?? 'application/json'
      if (!jsonMime(contentType)) {
        throw new ContractError([issue('The contract handler supports JSON responses only.', 'content-type')])
      }
      const mime = contentType.split(';')[0]!.trim().toLowerCase()
      const validator = contract.get(mime) ?? contract.get(`${mime.split('/')[0]}/*`) ?? contract.get('*/*')
      if (!validator) {
        throw new ContractError([issue(`No response contract for ${contentType}.`, 'content-type')])
      }
      let serialized: string | undefined
      try {
        serialized = JSON.stringify(reply.body)
      }
      catch {
        throw new ContractError([issue('Mock response cannot be serialized as JSON.')])
      }
      if (serialized === undefined || new TextEncoder().encode(serialized).length > maxBodyBytes) {
        throw new ContractError([issue(`JSON response is absent or exceeds ${maxBodyBytes} bytes.`)])
      }
      // Validate exactly what consumers receive, including toJSON and omitted properties.
      validator.parse(JSON.parse(serialized))
      headers.set('content-type', contentType)
      headers.delete('content-length')
      headers.delete('transfer-encoding')
      return new Response(operation.method.toUpperCase() === 'HEAD' ? null : serialized, { status: reply.status, headers })
    },
  })
}
