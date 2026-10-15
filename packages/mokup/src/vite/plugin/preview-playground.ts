import type { MiddlewareHandler } from './middleware'
import { normalizeBase, normalizePlaygroundPath, resolvePlaygroundRequestPath } from '@mokup/core/playground/config'
import { normalize } from '@mokup/shared/pathe'
import { parseHttpRequestUrl } from '../../shared/http-request'

function resolveStaticMount(base: string, playgroundPath: string) {
  const basePath = normalize(normalizeBase(base) || '/')
  const mountPath = normalizePlaygroundPath(normalize(resolvePlaygroundRequestPath(base, playgroundPath)))
  // Root output is rejected by the writer, so it must not reserve the entire
  // application's request namespace or disable its mock routes in preview.
  if (mountPath === '/' || mountPath === basePath
    || (basePath !== '/' && !mountPath.startsWith(`${basePath}/`))) {
    return null
  }
  return mountPath
}

export function createStaticPlaygroundPreviewMiddleware(params: {
  base: string
  playgroundPath: string
  mockMiddleware: MiddlewareHandler | null
}): MiddlewareHandler {
  const mountPath = resolveStaticMount(params.base, params.playgroundPath)
  return (req, res, next) => {
    if (mountPath) {
      const url = parseHttpRequestUrl(req, res)
      if (!url) {
        return
      }
      if (url.pathname === mountPath) {
        res.statusCode = 302
        res.setHeader('Location', `${mountPath}/${url.search}`)
        res.end()
        return
      }
      if (url.pathname.startsWith(`${mountPath}/`)) {
        return next()
      }
    }
    return params.mockMiddleware ? params.mockMiddleware(req, res, next) : next()
  }
}
