import type { IncomingMessage, ServerResponse } from 'node:http'

interface WebpackPluginInstance {
  apply: (compiler: WebpackCompiler) => void
}

interface WebpackDevMiddleware {
  name?: string
  middleware: (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => void | Promise<void>
}

interface WebpackDevServer {
  app?: { use: (middleware: WebpackDevMiddleware['middleware']) => void }
}

interface WebpackCompilation {
  hooks: {
    processAssets: {
      tapPromise: (
        options: { name: string, stage: number },
        handler: () => Promise<void>,
      ) => void
    }
  }
  emitAsset: (name: string, source: { source: () => string }) => void
  updateAsset: (name: string, source: { source: () => string }) => void
  getAsset: (name: string) => unknown
  getAssetPath: (name: string, data?: { hash?: string }) => string
  outputOptions: {
    publicPath?: unknown
  }
  hash?: string
}

interface WebpackCompiler {
  context?: string
  options: {
    output?: {
      publicPath?: unknown
      assetModuleFilename?: unknown
    }
    devServer?: {
      setupMiddlewares?: (
        middlewares: WebpackDevMiddleware[],
        devServer: WebpackDevServer,
      ) => WebpackDevMiddleware[]
      devMiddleware?: {
        publicPath?: unknown
      }
    }
  }
  hooks: {
    beforeRun?: { tap: (name: string, handler: () => void) => void }
    beforeCompile: { tapPromise: (name: string, handler: () => Promise<void>) => void }
    thisCompilation: { tap: (name: string, handler: (compilation: WebpackCompilation) => void) => void }
    watchRun: { tap: (name: string, handler: (compiler: WebpackCompiler) => void) => void }
    watchClose: { tap: (name: string, handler: () => void) => void }
    shutdown?: { tapPromise: (name: string, handler: () => Promise<void>) => void }
  }
  watching?: { invalidate: () => void }
  webpack: {
    Compilation: { PROCESS_ASSETS_STAGE_ADDITIONS: number }
    sources: { RawSource: new (source: string) => { source: () => string } }
  }
}

export type {
  WebpackCompilation,
  WebpackCompiler,
  WebpackDevMiddleware,
  WebpackDevServer,
  WebpackPluginInstance,
}
