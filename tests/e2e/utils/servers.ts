import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { WEB_HOST, WEB_PORT } from '../constants'
import { isPortOpen, waitForHttp } from './net'
import { stopProcess } from './process.mjs'

export interface RunningServer {
  name: string
  process: ChildProcess
  url: string
}

interface ServerCommand {
  command: string
  args: string[]
}

function formatServerLabel(params: {
  name: string
  cwd: string
  command: string
  args: string[]
  url: string
}) {
  return [
    `name=${params.name}`,
    `cwd=${params.cwd}`,
    `url=${params.url}`,
    `command=${[params.command, ...params.args].join(' ')}`,
  ].join(', ')
}

function waitForUnexpectedExit(child: ChildProcess, label: string) {
  return new Promise<never>((_, reject) => {
    child.once('error', (error) => {
      reject(new Error(`Failed to start dev server (${label}): ${String(error)}`))
    })
    child.once('exit', (code, signal) => {
      reject(
        new Error(
          `Dev server exited before becoming ready (${label}, code=${String(code)}, signal=${String(signal)})`,
        ),
      )
    })
  })
}

function getPnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function resolveViteCommand(repoRoot: string, host: string, port: number): ServerCommand {
  const viteBin = join(repoRoot, 'node_modules', '.bin', 'vite')
  const viteArgs = ['--host', host, '--port', String(port)]
  if (existsSync(viteBin)) {
    return {
      command: viteBin,
      args: viteArgs,
    }
  }

  return {
    command: getPnpmCommand(),
    args: ['exec', 'vite', ...viteArgs],
  }
}

export async function startViteServer(params?: {
  reuseExistingServer?: boolean
  cwd?: string
  env?: NodeJS.ProcessEnv
  appDir?: string
  host?: string
  port?: number
  name?: string
}) {
  const reuseExistingServer = params?.reuseExistingServer ?? false
  const port = params?.port ?? WEB_PORT
  const host = params?.host ?? WEB_HOST
  const baseUrl = `http://${host}:${port}`
  if (reuseExistingServer && await isPortOpen(port, host)) {
    return null
  }

  const repoRoot = params?.cwd ?? process.cwd()
  const appDir = params?.appDir ?? join('apps', 'mokup-web-demo')
  const appRoot = isAbsolute(appDir) ? appDir : resolve(repoRoot, appDir)
  const name = params?.name ?? 'mokup-web-demo'
  const serverCommand = resolveViteCommand(repoRoot, host, port)
  const label = formatServerLabel({
    name,
    cwd: appRoot,
    url: baseUrl,
    command: serverCommand.command,
    args: serverCommand.args,
  })

  if (!existsSync(appRoot)) {
    throw new Error(`Dev server app directory does not exist (${label})`)
  }

  const child = spawn(
    serverCommand.command,
    serverCommand.args,
    {
      cwd: appRoot,
      env: {
        ...process.env,
        ...params?.env,
      },
      stdio: 'inherit',
    },
  )

  try {
    await Promise.race([
      waitForHttp(baseUrl, 60_000),
      waitForUnexpectedExit(child, label),
    ])
  }
  catch (error) {
    try {
      await stopProcess(child)
    }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Dev server startup and cleanup failed (${label})`)
    }
    throw error
  }

  return {
    name,
    process: child,
    url: baseUrl,
  } satisfies RunningServer
}

export async function stopServers(servers: RunningServer[]) {
  const results = await Promise.allSettled(servers.map(async (server) => {
    try {
      await stopProcess(server.process)
    }
    catch (error) {
      throw new Error(`Failed to stop dev server ${server.name} (${server.url})`, { cause: error })
    }
  }))
  const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  if (errors.length) {
    throw new AggregateError(errors, 'Failed to stop all dev servers')
  }
}
