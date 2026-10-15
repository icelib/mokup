import type { ViteDevServer } from 'vite'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
import { createMokupPlugin } from '../../../packages/mokup/src/vite/plugin'
import { repoRoot } from './paths'

export async function startEmptySwServer(runtime: 'node' | 'worker', register = true) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mokup-empty-sw-')))
  const mockDir = path.join(root, 'mock')
  let server: ViteDevServer | undefined
  try {
    await mkdir(mockDir)
    await mkdir(path.join(root, 'node_modules/@mokup'), { recursive: true })
    await symlink(path.join(repoRoot, 'packages/mokup'), path.join(root, 'node_modules/mokup'), 'junction')
    await symlink(path.join(repoRoot, 'packages/shared'), path.join(root, 'node_modules/@mokup/shared'), 'junction')
    await writeFile(path.join(root, 'index.html'), '<!doctype html><html><body>Empty mock workspace</body></html>')
    server = await createServer({
      root,
      base: '/workspace/',
      configFile: false,
      logLevel: 'silent',
      server: {
        host: '127.0.0.1',
        port: 0,
        fs: { allow: [root, repoRoot] },
        // Exercise atomic unlink/add handling on macOS as well as Linux CI.
        watch: { atomic: true, useFsEvents: false, usePolling: false },
      },
      plugins: [
        createMokupPlugin({
          runtime,
          entries: { dir: mockDir, prefix: '/workspace/api', mode: 'sw', sw: { fallback: false, register }, log: false },
          playground: false,
        }),
        {
          name: 'network-sentinel',
          configureServer(vite) {
            vite.middlewares.use((req, res, next) => {
              if (req.url === '/workspace/api/value') {
                res.statusCode = 207
                res.setHeader('content-type', 'application/json')
                res.end('{"source":"network"}')
                return
              }
              next()
            })
          },
        },
      ],
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing Vite HTTP address')
    }
    return {
      url: `http://127.0.0.1:${address.port}/workspace/`,
      server,
      mockDir,
      routeFile: path.join(mockDir, 'value.get.json'),
      async close() {
        try {
          await server?.close()
        }
        finally {
          await rm(root, { recursive: true, force: true })
        }
      },
    }
  }
  catch (error) {
    try {
      await server?.close()
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
    throw error
  }
}
