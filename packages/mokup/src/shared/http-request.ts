import type { IncomingMessage, ServerResponse } from 'node:http'

export function parseHttpRequestUrl(req: IncomingMessage, res: ServerResponse): URL | null {
  const target = req.url ?? '/'
  const origin = 'http://mokup.local'
  try {
    // HTTP origin-form paths may start with //; they do not name another host.
    return new URL(target.startsWith('/') ? `${origin}${target}` : target, origin)
  }
  catch {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Invalid request URL.')
    return null
  }
}
