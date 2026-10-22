import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import mokup from 'mokup/vite'
import { createServer } from 'vite'
import { getMokupViteAliases } from '../../../../scripts/mokup-alias.mjs'

const execFileAsync = promisify(execFile)
const appRoot = fileURLToPath(new URL('../..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const abortController = new AbortController()
const childEnv = {
  ...process.env,
  E2E: '1',
  WRANGLER_SEND_METRICS: 'false',
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
}

async function getFreePort() {
  const server = createNetServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  if (!address || typeof address === 'string') {
    throw new Error('Unable to reserve a port for the local D1 test.')
  }
  return address.port
}

async function runTool(script, args) {
  return execFileAsync(process.execPath, [script, ...args], {
    cwd: appRoot,
    env: childEnv,
    signal: abortController.signal,
    maxBuffer: 4 * 1024 * 1024,
  })
}

async function runPlaywright(baseURL) {
  const cli = join(repoRoot, 'node_modules/@playwright/test/cli.js')
  const extraArgs = process.argv.slice(2)
  if (extraArgs[0] === '--') {
    extraArgs.shift()
  }
  const child = spawn(process.execPath, [cli, 'test', '--config', 'playwright.d1.config.ts', ...extraArgs], {
    cwd: appRoot,
    env: { ...childEnv, E2E_BASE_URL: baseURL },
    signal: abortController.signal,
    stdio: 'inherit',
  })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
      }
      else {
        reject(new Error(`Local D1 Playwright tests exited with ${String(code ?? signal)}.`))
      }
    })
  })
}

async function main() {
  const port = await getFreePort()
  const directory = await mkdtemp(join(tmpdir(), 'mokup-d1-e2e-'))
  const configPath = join(directory, 'wrangler.json')
  const persistPath = join(directory, 'state')
  const sqlPath = join(directory, 'schema.sql')
  const baseURL = `http://127.0.0.1:${port}`
  let server
  const onSignal = () => abortController.abort()
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    await writeFile(configPath, JSON.stringify({
      name: 'mokup-d1-e2e',
      main: join(appRoot, 'worker/src/index.ts'),
      compatibility_date: '2025-01-15',
      compatibility_flags: ['nodejs_compat'],
      d1_databases: [{
        binding: 'DB',
        database_name: 'mokup-d1-e2e',
        database_id: '00000000-0000-0000-0000-000000000001',
        remote: false,
      }],
      vars: {
        BETTER_AUTH_URL: baseURL,
        BETTER_AUTH_SECRET: 'mokup-local-d1-test-secret-at-least-32-characters',
        GITHUB_CLIENT_ID: 'local-test-client',
        GITHUB_CLIENT_SECRET: 'local-test-secret',
      },
    }))

    const { stdout: schema } = await runTool(join(appRoot, 'node_modules/drizzle-kit/bin.cjs'), [
      'export',
      '--dialect',
      'sqlite',
      '--schema',
      './db/schema.ts',
    ])
    if (!schema.trimStart().startsWith('CREATE TABLE')) {
      throw new Error('Drizzle did not export the local D1 schema.')
    }
    const seed = await readFile(new URL('../d1/seed.sql', import.meta.url), 'utf8')
    await writeFile(sqlPath, `${schema}\n${seed}`)
    await runTool(join(appRoot, 'node_modules/wrangler/bin/wrangler.js'), [
      'd1',
      'execute',
      'DB',
      '--local',
      '--config',
      configPath,
      '--persist-to',
      persistPath,
      '--file',
      sqlPath,
    ])

    server = await createServer({
      root: appRoot,
      configFile: false,
      cacheDir: join(directory, 'vite'),
      plugins: [
        vue(),
        tailwindcss(),
        cloudflare({ configPath, persistState: { path: persistPath }, remoteBindings: false, inspectorPort: false }),
        mokup({ runtime: 'worker', entries: { dir: 'mock', prefix: '/api' } }),
      ],
      resolve: { alias: getMokupViteAliases() },
      optimizeDeps: { noDiscovery: true, entries: [] },
      server: { host: '127.0.0.1', port, strictPort: true, hmr: { overlay: false } },
    })
    await server.listen()
    await runPlaywright(baseURL)
  }
  finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    try {
      await server?.close()
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
