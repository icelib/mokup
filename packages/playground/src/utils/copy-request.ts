import type { RawBodyType } from '../types'
import type { BuildCurlOptions } from './curl'
import { parseKeyValueInput } from '../hooks/playground-request/query'

type CopyRequestBody
  = | { type: 'text', value: string }
    | { type: 'form-data', entries: Array<[string, string]> }

function resolveContentType(rawType: RawBodyType): string {
  switch (rawType) {
    case 'json': return 'application/json; charset=utf-8'
    case 'javascript': return 'application/javascript; charset=utf-8'
    case 'html': return 'text/html; charset=utf-8'
    case 'xml': return 'text/xml; charset=utf-8'
    default: return 'text/plain; charset=utf-8'
  }
}

function prepareCopyRequest(options: BuildCurlOptions) {
  const method = options.method.toUpperCase()
  const url = new URL(options.url, 'http://localhost')
  const headers = new Map(Object.entries(options.headers))
  const setDefaultContentType = (value: string) => {
    if (!Array.from(headers.keys()).some(name => name.toLowerCase() === 'content-type')) {
      headers.set('Content-Type', value)
    }
  }

  if (options.authType === 'bearer' && options.authToken) {
    headers.set('Authorization', `Bearer ${options.authToken}`)
  }
  else if (options.authType === 'basic' && (options.authUsername || options.authPassword)) {
    headers.set('Authorization', `Basic ${btoa(`${options.authUsername}:${options.authPassword}`)}`)
  }
  else if (options.authType === 'apikey' && options.authKeyName && options.authKeyValue) {
    if (options.authKeyLocation === 'query') {
      url.searchParams.set(options.authKeyName, options.authKeyValue)
    }
    else {
      headers.set(options.authKeyName, options.authKeyValue)
    }
  }
  else if (options.authType === 'custom' && options.authCustomName) {
    headers.set(options.authCustomName, options.authCustomValue)
  }

  let body: CopyRequestBody | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    if (options.bodyType === 'raw' && options.bodyText.trim()) {
      setDefaultContentType(resolveContentType(options.rawType))
      body = { type: 'text', value: options.bodyText }
    }
    else if (options.bodyType === 'form-urlencoded' || options.bodyType === 'form-data') {
      const entries = parseKeyValueInput(options.bodyText)
      if (entries.length > 0) {
        if (options.bodyType === 'form-urlencoded') {
          setDefaultContentType('application/x-www-form-urlencoded; charset=utf-8')
          body = { type: 'text', value: new URLSearchParams(entries).toString() }
        }
        else {
          body = { type: 'form-data', entries }
        }
      }
    }
  }

  return { method, url: url.toString(), headers: Array.from(headers.entries()), body }
}

export { prepareCopyRequest }
