import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { MOCK_VITE_SERVER_PORT } from './constants'
import { runCommand } from './utils/command'
import { startViteServer, stopServers } from './utils/servers'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default async function globalSetup() {
  if (!process.env['MOKUP_E2E_SKIP_BUILD']) {
    await runCommand('pnpm', ['run', 'build:packages'], { cwd: repoRoot })
  }

  const servers = [] as NonNullable<Awaited<ReturnType<typeof startViteServer>>>[]
  const reuseExistingServer = !process.env['CI']
  try {
    const viteServer = await startViteServer({
      cwd: repoRoot,
      env: {
        VITE_USE_MOCK: 'false',
      },
      reuseExistingServer,
    })
    if (viteServer) {
      servers.push(viteServer)
    }
    const demoServer = await startViteServer({
      cwd: repoRoot,
      appDir: 'apps/mokup-vite-server-demo',
      port: MOCK_VITE_SERVER_PORT,
      reuseExistingServer,
    })
    if (demoServer) {
      servers.push(demoServer)
    }
  }
  catch (error) {
    try {
      await stopServers(servers)
    }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'E2E setup and server cleanup failed')
    }
    throw error
  }

  return async () => {
    await stopServers(servers)
  }
}
