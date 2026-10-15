import type { InlineConfig, PreviewServer } from 'vite'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { build, preview } from 'vite'
import { createMokupPlugin } from '../../../packages/mokup/src/vite/plugin'
import { repoRoot } from './paths'

export async function startPreviewPlaygroundServer(playgroundPath: string) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mokup-preview-playground-')))
  let misplacedOutput: string | undefined
  let server: PreviewServer | undefined
  const close = async () => {
    try {
      await server?.close()
    }
    finally {
      await rm(root, { recursive: true, force: true })
      if (misplacedOutput) {
        await rm(misplacedOutput, { recursive: true, force: true })
      }
    }
  }
  try {
    // Reserve a unique cwd-relative target so even the broken writer only
    // touches this fixture's files, never the repository's shared dist.
    const cache = path.join(process.cwd(), 'node_modules/.cache')
    await mkdir(cache, { recursive: true })
    misplacedOutput = await mkdtemp(path.join(cache, 'mokup-playground-output-'))
    const outDir = path.relative(process.cwd(), misplacedOutput)
    const mockDir = path.join(root, 'mock')
    const serverDir = path.join(root, 'server-mock')
    await mkdir(mockDir)
    await mkdir(serverDir)
    await mkdir(path.join(root, 'node_modules/@mokup'), { recursive: true })
    await symlink(path.join(repoRoot, 'packages/mokup'), path.join(root, 'node_modules/mokup'), 'junction')
    await symlink(path.join(repoRoot, 'packages/shared'), path.join(root, 'node_modules/@mokup/shared'), 'junction')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }))
    await writeFile(path.join(root, 'index.html'), '<!doctype html><html><body>Application sentinel</body></html>')
    await writeFile(path.join(mockDir, 'value.get.json'), '{"source":"build","revision":1}')
    await writeFile(path.join(mockDir, 'built-only.get.json'), '{"built":true}')
    await writeFile(path.join(serverDir, '[...path].get.json'), '{"source":"server-catch-all"}')
    const config = (): InlineConfig => ({
      root,
      base: '/workspace/',
      configFile: false,
      logLevel: 'silent',
      build: { outDir },
      plugins: [
        createMokupPlugin({
          entries: [
            { dir: mockDir, prefix: '/workspace/api', mode: 'sw', sw: { fallback: false }, watch: false, log: false },
            { dir: serverDir, prefix: '/workspace/inspect', watch: false, log: false },
          ],
          playground: { build: true, path: playgroundPath },
        }),
        {
          name: 'playground-preview-network-sentinel',
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
    await build(config())
    const output = path.join(root, outDir, 'inspect/mocks')
    const html = await readFile(path.join(output, 'index.html'), 'utf8')
    const routes = await readFile(path.join(output, 'routes'), 'utf8')
    const misplacedFiles = await readdir(misplacedOutput)
    await writeFile(path.join(mockDir, 'value.get.json'), '{"source":"unbuilt","revision":2}')
    await rm(path.join(mockDir, 'built-only.get.json'))
    await writeFile(path.join(mockDir, 'source-only.get.json'), '{"unbuilt":true}')
    server = await preview({ ...config(), preview: { host: '127.0.0.1', port: 0 } })
    const address = server.httpServer.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing Playground preview HTTP address')
    }
    return { url: `http://127.0.0.1:${address.port}/workspace/`, html, routes, misplacedFiles, close }
  }
  catch (error) {
    await close()
    throw error
  }
}
