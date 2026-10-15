import type { AuthType, BodyType, RawBodyType } from '../types'
import { prepareCopyRequest } from './copy-request'

function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

interface BuildCurlOptions {
  method: string
  url: string
  headers: Record<string, string>
  bodyType: BodyType
  rawType: RawBodyType
  bodyText: string
  authType: AuthType
  authToken: string
  authUsername: string
  authPassword: string
  authKeyName: string
  authKeyValue: string
  authKeyLocation: 'header' | 'query'
  authCustomName: string
  authCustomValue: string
}

function buildCurl(options: BuildCurlOptions): string {
  const { method, url, headers, body } = prepareCopyRequest(options)
  const parts: string[] = ['curl', '--globoff']

  if (method === 'HEAD') {
    parts.push('--head')
  }
  else if (method !== 'GET') {
    parts.push(`-X ${shellEscape(method)}`)
  }
  parts.push(shellEscape(url))
  for (const [key, value] of headers) {
    const header = /^[\t ]*$/.test(value) ? `${key};` : `${key}: ${value}`
    parts.push(`-H ${shellEscape(header)}`)
  }

  if (body?.type === 'text') {
    parts.push(`--data-raw ${shellEscape(body.value)}`)
  }
  else if (body?.type === 'form-data') {
    for (const [key, value] of body.entries) {
      parts.push(`--form-string ${shellEscape(`${key}=${value}`)}`)
    }
  }

  return parts.join(' \\\n  ')
}

export type { BuildCurlOptions }
export { buildCurl }
