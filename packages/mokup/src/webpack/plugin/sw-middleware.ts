import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebpackBuildSession } from './session'
import { parseHttpRequestUrl } from '../../shared/http-request'
import { resolveRegisterPath } from './paths'

function createSwMiddleware(params: {
  swConfig: { path: string } | null
  getSession: () => WebpackBuildSession | null
  getBase: () => string
}) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => {
    const session = params.getSession()
    const snapshot = session?.peek()
    if (!params.swConfig || !session?.isActive() || !snapshot?.state.swRoutes.length) {
      return next()
    }
    const parsed = parseHttpRequestUrl(req, res)
    if (!parsed) {
      return
    }
    const swPath = resolveRegisterPath(snapshot.base, params.swConfig.path)
    if (parsed.pathname !== swPath) {
      return next()
    }

    const built = await session.ensureBuilt() ?? session.peek()
    if (!built || !session.isActive() || params.getSession() !== session || built.base !== snapshot.base || params.getBase() !== snapshot.base) {
      return next()
    }
    const bundle = built.bundles.swBundle
    if (!bundle) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Failed to generate mokup service worker.')
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.end(bundle)
  }
}

export { createSwMiddleware }
