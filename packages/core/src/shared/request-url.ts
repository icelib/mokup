import type { ServerResponse } from 'node:http'

const requestOrigin = 'http://mokup.local'

export function parseRequestUrl(target: string): URL | null {
  try {
    // Origin-form targets keep leading double slashes as part of the path.
    const url = new URL(target.startsWith('/') ? `${requestOrigin}${target}` : target, requestOrigin)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  }
  catch {
    return null
  }
}

export function sendInvalidRequestUrl(res: ServerResponse) {
  res.statusCode = 400
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end('Invalid request URL.')
}
