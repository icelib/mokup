import type { InlineConfig, ViteDevServer } from 'vite'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createLogger, createServer, normalizePath } from 'vite'
import { expect } from 'vitest'

interface ViteFixture {
  root: string
  createServer: (options?: Pick<InlineConfig, 'plugins' | 'resolve'>) => Promise<ViteDevServer>
}

export function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Vite module load did not reach the expected stage')), 5000)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

export function cleanId(id: string): string {
  return normalizePath(id.split('?')[0] ?? id)
}

export function querySuffix(id: string): string {
  const index = id.indexOf('?')
  return index === -1 ? '' : id.slice(index)
}

export function moduleIds(server: ViteDevServer, file: string) {
  return [...server.moduleGraph.getModulesByFile(normalizePath(file)) ?? []]
    .map(node => node.id)
    .sort()
}

async function closeServers(servers: ViteDevServer[]) {
  const closed = await Promise.allSettled(servers.map(server => server.close()))
  const failures = closed.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to close Vite identity test servers')
  }
}

export async function withViteFixture(run: (fixture: ViteFixture) => Promise<void>) {
  const temporary = await fs.mkdtemp(path.join(tmpdir(), 'mokup-vite-identity-'))
  const servers: ViteDevServer[] = []
  try {
    // Match Vite's default filesystem identity, including macOS's /var symlink.
    const root = await fs.realpath(temporary)
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}\n')
    await run({
      root,
      async createServer(options = {}) {
        const server = await createServer({
          root,
          configFile: false,
          customLogger: createLogger('silent'),
          optimizeDeps: { noDiscovery: true, include: [] },
          server: { middlewareMode: true, hmr: false, watch: null, ws: false },
          ...options,
        })
        servers.push(server)
        expect(server.httpServer).toBeNull()
        expect(server.watcher.getWatched()).toEqual({})
        return server
      },
    })
  }
  finally {
    try {
      await closeServers(servers)
    }
    finally {
      await fs.rm(temporary, { recursive: true, force: true })
    }
  }
}
