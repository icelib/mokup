import { createRequire } from 'node:module'
import { join } from '@mokup/shared/pathe'

const require = createRequire(import.meta.url)

export type PlaygroundDistResolver = () => string

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

function resolvePlaygroundDist(resolver?: PlaygroundDistResolver) {
  if (resolver) {
    return resolver()
  }
  const pkgPath = require.resolve('@mokup/playground/package.json')
  return join(pkgPath, '..', 'dist')
}

function sendJson(
  res: import('node:http').ServerResponse,
  data: unknown,
  statusCode = 200,
) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data, null, 2))
}

function sendFile(
  res: import('node:http').ServerResponse,
  content: string | Uint8Array,
  contentType: string,
) {
  res.statusCode = 200
  res.setHeader('Content-Type', contentType)
  res.end(content)
}

export { mimeTypes, resolvePlaygroundDist, sendFile, sendJson }
