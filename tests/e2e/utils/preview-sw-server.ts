import type { InlineConfig, PreviewServer } from 'vite'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build, preview } from 'vite'
import { createMokupPlugin } from '../../../packages/mokup/src/vite/plugin'
import { repoRoot } from './paths'

interface PreviewSwOptions {
  workerPath?: string
  playground?: boolean
  removeSource?: boolean
  removeWorker?: boolean
  unregister?: boolean
  buildRegister?: boolean
}

export async function startPreviewSwServer(runtime: 'node' | 'worker', register = true, options: PreviewSwOptions = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mokup-preview-sw-')))
  const mockDir = path.join(root, 'mock')
  let server: PreviewServer | undefined
  try {
    await mkdir(mockDir)
    await mkdir(path.join(root, 'node_modules/@mokup'), { recursive: true })
    await symlink(path.join(repoRoot, 'packages/mokup'), path.join(root, 'node_modules/mokup'), 'junction')
    await symlink(path.join(repoRoot, 'packages/shared'), path.join(root, 'node_modules/@mokup/shared'), 'junction')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }))
    await writeFile(path.join(root, 'index.html'), '<!doctype html><html><body>Built SW preview</body></html>')
    if (options.playground) {
      const publicDir = path.join(root, 'public')
      await mkdir(publicDir)
      await writeFile(path.join(publicDir, 'fixture-setup.html'), '<!doctype html><html><body>Registration setup without lifecycle scripts</body></html>')
      await writeFile(path.join(publicDir, 'unrelated-worker.js'), [
        'self.addEventListener("install", () => self.skipWaiting())',
        'self.addEventListener("activate", event => event.waitUntil(self.clients.claim()))',
      ].join('\n'))
    }
    const routeFile = path.join(mockDir, 'value.get.json')
    await writeFile(routeFile, JSON.stringify({ source: 'build', revision: 1 }))
    await writeFile(path.join(mockDir, 'typed.get.ts'), [
      'import { defineHandler } from "mokup"',
      'export default defineHandler(c => ({ source: "typescript", query: c.req.query("value") }))',
    ].join('\n'))
    await writeFile(path.join(mockDir, 'index.config.ts'), [
      'import { defineConfig } from "mokup"',
      'export default defineConfig({',
      '  middleware: async (c, next) => {',
      '    await next()',
      '    c.header("x-built-middleware", "yes")',
      '  },',
      '})',
    ].join('\n'))
    const config = (building = false): InlineConfig => ({
      root,
      base: '/workspace/',
      configFile: false,
      logLevel: 'silent',
      plugins: [
        createMokupPlugin({
          runtime,
          entries: {
            dir: mockDir,
            prefix: '/workspace/api',
            mode: 'sw',
            sw: {
              ...(options.workerPath ? { path: options.workerPath } : {}),
              fallback: false,
              register: building ? options.buildRegister ?? register : register,
              unregister: !building && options.unregister === true,
            },
            watch: false,
            log: false,
          },
          playground: options.playground ? { build: false } : false,
        }),
        {
          name: 'preview-network-sentinel',
          configurePreviewServer(vite) {
            vite.middlewares.use((req, res, next) => {
              if (req.url?.startsWith('/workspace/api/')) {
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
    await build(config(true))
    const workerFile = path.join(root, 'dist/mokup-sw.js')
    const worker = await readFile(workerFile, 'utf8')
    // Preview must serve the built snapshot even if source mocks have since changed.
    await writeFile(routeFile, JSON.stringify({ source: 'unbuilt', revision: 2 }))
    if (options.removeSource) {
      await rm(mockDir, { recursive: true })
      await mkdir(mockDir)
    }
    if (options.removeWorker) {
      await rm(workerFile)
    }
    server = await preview({ ...config(), preview: { host: '127.0.0.1', port: 0 } })
    const address = server.httpServer.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing Vite preview HTTP address')
    }
    return {
      url: `http://127.0.0.1:${address.port}/workspace/`,
      worker,
      readOutput: (file: string) => readFile(path.join(root, 'dist', file), 'utf8'),
      removeWorker: () => rm(workerFile, { force: true }),
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
