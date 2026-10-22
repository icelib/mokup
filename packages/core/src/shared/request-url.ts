import type { IncomingMessage, ServerResponse } from 'node:http'

const requestOrigin = 'http://mokup.local'

export function parseRequestUrl(target: string, req?: IncomingMessage): URL | null {
  try {
    const host = req?.headers.host
    if (host && (/[\\/?#@\s]/.test(host))) {
      return null
    }
    const protocol = req?.socket && 'encrypted' in req.socket && req.socket.encrypted ? 'https' : 'http'
    const origin = host ? `${protocol}://${host}` : requestOrigin
    // Origin-form targets keep leading double slashes as part of the path.
    const url = new URL(target.startsWith('/') ? `${origin}${target}` : target, origin)
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
