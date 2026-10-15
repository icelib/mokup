import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { connect, createServer } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { stopProcess } from './utils/process.mjs'

const ACCESS_HOST = process.env.E2E_ACCESS_HOST || '127.0.0.1'
const BIND_HOST = process.env.E2E_BIND_HOST || '127.0.0.1'
const DEFAULT_TIMEOUT_MS = 60_000
const READY_URL_RE = /(Local|Network):\s+(https?:\/\/[^\s/]+:\d+)\//i
const WORKSPACE_RELATIVE_SPLIT_RE = /[/\\]+/
const VITE_LOCK_NAME = '.e2e-vite.lock'
const VITE_LOCK_STALE_MS = 10 * 60 * 1000

function stripAnsi(input) {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\u001B\[[0-9;]*m/g, '')
}

function formatCommand(command, args = []) {
  return [command, ...args].join(' ')
}

function formatAppContext(params) {
  return [
    `app=${params.appName}`,
    `cwd=${params.cwd}`,
    ...(params.url ? [`url=${params.url}`] : []),
    ...(typeof params.port === 'number' ? [`port=${params.port}`] : []),
    ...(params.command ? [`command=${params.command}`] : []),
  ].join(', ')
}

function findRepoRoot(startDir) {
  let current = resolve(startDir)
  while (current !== dirname(current)) {
    if (isWorkspaceRoot(current)) {
      return current
    }
    current = dirname(current)
  }
  return startDir
}

function isWorkspaceRoot(dir) {
  try {
    return ['pnpm-workspace.yaml', 'turbo.json']
      .map(file => join(dir, file))
      .some(file => existsSync(file))
  }
  catch {
    return false
  }
}

function detectAppName(repoRoot, cwd, argName) {
  if (argName) {
    return argName
  }
  const rel = relative(repoRoot, cwd)
  const parts = rel.split(WORKSPACE_RELATIVE_SPLIT_RE).filter(Boolean)
  if (parts[0] === 'apps' && parts[1]) {
    return parts[1]
  }
  throw new Error('Unable to determine app name. Pass it as the first argument.')
}

function createCommandEnv(extraEnv) {
  if (!extraEnv) {
    return process.env
  }
  return {
    ...process.env,
    ...extraEnv,
  }
}

function runChildProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: createCommandEnv(options.env),
      stdio: options.stdio ?? 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve(child)
        return
      }
      reject(new Error(`Command failed with code ${String(code)} and signal ${String(signal)}`))
    })
  })
}

async function acquireLock(lockPath, timeoutMs) {
  const start = Date.now()
  const payload = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  })

  while (Date.now() - start < timeoutMs) {
    try {
      await fs.writeFile(lockPath, payload, { flag: 'wx' })
      return true
    }
    catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }
      try {
        const lockRaw = await fs.readFile(lockPath, 'utf8')
        const lockInfo = JSON.parse(lockRaw)
        const lockPid = Number(lockInfo?.pid)
        if (Number.isInteger(lockPid) && lockPid > 0 && lockPid !== process.pid) {
          try {
            process.kill(lockPid, 0)
          }
          catch (pidError) {
            if (pidError?.code === 'ESRCH') {
              await fs.unlink(lockPath)
              continue
            }
          }
        }
      }
      catch {
        // ignore parse/read errors and continue to stale-time checks
      }
      try {
        const stat = await fs.stat(lockPath)
        if (Date.now() - stat.mtimeMs > VITE_LOCK_STALE_MS) {
          await fs.unlink(lockPath)
          continue
        }
      }
      catch {
        // ignore stat/unlink errors, keep waiting
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  throw new Error(`Timeout waiting to acquire Vite lock at ${lockPath}`)
}

async function releaseLock(lockPath) {
  try {
    await fs.unlink(lockPath)
  }
  catch {
    // ignore missing lock
  }
}

function resolveBin(binName, appRoot, repoRoot) {
  const appBin = join(appRoot, 'node_modules', '.bin', binName)
  if (existsSync(appBin)) {
    return appBin
  }
  const rootBin = join(repoRoot, 'node_modules', '.bin', binName)
  if (existsSync(rootBin)) {
    return rootBin
  }
  return binName
}

function getAppConfig(appName, repoRoot, appRoot) {
  const viteBin = resolveBin('vite', appRoot, repoRoot)
  const vitepressBin = resolveBin('vitepress', appRoot, repoRoot)
  const tsxBin = resolveBin('tsx', appRoot, repoRoot)

  const configs = {
    'mokup-web-demo': {
      readyPath: '/',
      server: { command: viteBin, args: [] },
    },
    'mokup-vite-server-demo': {
      readyPath: '/',
      server: { command: viteBin, args: [] },
    },
    'mokup-vite-sw-demo': {
      readyPath: '/',
      server: { command: viteBin, args: [] },
    },
    'mokup-vite-host-sw-demo': {
      readyPath: '/',
      server: { command: viteBin, args: [] },
      cleanupPaths: ['dev-dist'],
    },
    'mokup-d1-demo': {
      readyPath: '/',
      server: { command: viteBin, args: [] },
    },
    'mokup-docs': {
      readyPath: '/',
      server: { command: vitepressBin, args: ['dev', 'docs'] },
    },
    'mokup-webpack-demo': {
      readyPath: '/',
      server: {
        command: tsxBin,
        args: [
          join(appRoot, 'node_modules/webpack-cli/bin/cli.js'),
          'serve',
          '--config',
          'webpack.config.ts',
          '--mode',
          'development',
        ],
      },
    },
    'mokup-node-demo': {
      readyPath: '/ping',
      server: {
        command: tsxBin,
        args: ['src/index.ts'],
        env: {},
      },
    },
    'mokup-middleware-demo': {
      readyPath: '/',
      preCommands: [
        { command: 'pnpm', args: ['build:mock'] },
      ],
      server: {
        command: tsxBin,
        args: ['src/index.ts'],
        env: {},
      },
    },
  }

  const config = configs[appName]
  if (!config) {
    throw new Error(`Unknown app name: ${appName}`)
  }
  return config
}

function getFreePort(host) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to acquire a port.'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError
  const perRequestTimeout = Math.min(2_000, Math.max(500, timeoutMs))
  while (Date.now() < deadline) {
    let timer
    try {
      const controller = new AbortController()
      timer = setTimeout(() => controller.abort(), perRequestTimeout)
      const response = await fetch(url, { method: 'GET', signal: controller.signal })
      if (response.ok || response.status < 500) {
        return
      }
    }
    catch (error) {
      lastError = error
    }
    finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Timeout waiting for HTTP readiness at ${url}: ${String(lastError)}`)
}

async function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const socket = connect(port, host)
        const cleanup = () => {
          socket.removeAllListeners()
          socket.destroy()
        }
        socket.once('connect', () => {
          cleanup()
          resolve()
        })
        socket.once('error', (error) => {
          cleanup()
          reject(error)
        })
        socket.setTimeout(500)
        socket.once('timeout', () => {
          cleanup()
          reject(new Error('Timeout while connecting'))
        })
      })
      return
    }
    catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Timeout waiting for TCP port ${host}:${port}: ${String(lastError)}`)
}

function createLineBuffer() {
  let buffer = ''
  return (chunk, onLine) => {
    buffer += chunk.toString()
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      onLine(line)
      index = buffer.indexOf('\n')
    }
  }
}

async function waitForViteReady(child, timeoutMs, onServerUrl) {
  return new Promise((resolve, reject) => {
    const onLineBuffer = createLineBuffer()
    let timeout
    let graceTimer
    let resolved = false

    function cleanup() {
      if (timeout) {
        clearTimeout(timeout)
      }
      if (graceTimer) {
        clearTimeout(graceTimer)
      }
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
      child.off('exit', onExit)
    }

    function handleLine(line) {
      const cleaned = stripAnsi(line)
      const match = cleaned.match(READY_URL_RE)
      if (match) {
        onServerUrl?.(match[2], match[1].toLowerCase())
        if (!resolved) {
          resolved = true
          if (timeout) {
            clearTimeout(timeout)
            timeout = undefined
          }
          resolve()
          graceTimer = setTimeout(() => {
            cleanup()
          }, 250)
        }
      }
    }

    function onData(chunk) {
      onLineBuffer(chunk, handleLine)
    }

    function onExit(code, signal) {
      cleanup()
      reject(new Error(`Dev server exited before ready (code: ${code ?? 'null'}, signal: ${signal ?? 'null'}).`))
    }

    timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timeout waiting for Vite dev server to report readiness from stdout/stderr.'))
    }, timeoutMs)

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', onExit)
  })
}

async function waitForReady({ host, port, url, timeoutMs }) {
  await waitForPort(host, port, timeoutMs)
  const httpTimeoutMs = Math.min(10_000, timeoutMs)
  await waitForHttp(url, httpTimeoutMs)
}

async function waitForViteStable({
  child,
  readyPath,
  timeoutMs,
  defaultBaseURL,
}) {
  const deadline = Date.now() + timeoutMs
  let baseURL = defaultBaseURL
  let lastError
  let hasLocalViteUrl = false
  const observedHosts = new Set()

  const normalizeAccessHost = (host) => {
    if (!host) {
      return ACCESS_HOST
    }
    const lowered = host.toLowerCase()
    if (lowered === '0.0.0.0' || lowered === '::') {
      return ACCESS_HOST
    }
    if (lowered === 'localhost') {
      return ACCESS_HOST
    }
    return host
  }

  const getHostCandidates = (host) => {
    const normalized = normalizeAccessHost(host)
    const isIpv6Host = normalized.includes(':')
    const candidates = isIpv6Host
      ? [normalized, '::1', ACCESS_HOST, 'localhost', '127.0.0.1']
      : [normalized, ACCESS_HOST, '127.0.0.1', 'localhost']
    return [...new Set(candidates.filter(Boolean))]
  }

  const updateBaseURL = (url, kind) => {
    try {
      const parsed = new URL(url)
      const hostname = normalizeAccessHost(parsed.hostname)
      const hostForUrl = hostname.includes(':') ? `[${hostname}]` : hostname
      if (hostname) {
        observedHosts.add(hostname)
      }
      if (kind === 'local') {
        hasLocalViteUrl = true
        baseURL = `${parsed.protocol}//${hostForUrl}:${parsed.port}`
        return
      }
      if (!hasLocalViteUrl) {
        baseURL = `${parsed.protocol}//${hostForUrl}:${parsed.port}`
      }
    }
    catch {
      // ignore malformed URLs from logs
    }
  }

  const initialWait = Math.min(10_000, timeoutMs)
  try {
    await waitForViteReady(child, initialWait, updateBaseURL)
  }
  catch (error) {
    lastError = error
  }

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Dev server exited while waiting for Vite to stabilize (code: ${child.exitCode}).`)
    }

    const remaining = deadline - Date.now()
    const parsed = new URL(baseURL)
    const host = parsed.hostname
    const port = parsed.port ? Number(parsed.port) : Number(new URL(defaultBaseURL).port)
    const hostsToTry = getHostCandidates(host)
    for (const observedHost of observedHosts) {
      if (!hostsToTry.includes(observedHost)) {
        hostsToTry.push(observedHost)
      }
    }

    for (const candidateHost of hostsToTry) {
      const hostForUrl = candidateHost.includes(':') ? `[${candidateHost}]` : candidateHost
      const candidateBaseURL = `${parsed.protocol}//${hostForUrl}:${port}`
      const candidateReadyUrl = new URL(readyPath, candidateBaseURL).toString()

      try {
        await waitForReady({
          host: candidateHost,
          port,
          url: candidateReadyUrl,
          timeoutMs: Math.min(5_000, remaining),
        })
        baseURL = candidateBaseURL
        return { baseURL, readyUrl: candidateReadyUrl }
      }
      catch (error) {
        lastError = error
      }
    }

    await new Promise(resolve => setTimeout(resolve, 250))
  }

  throw new Error(
    `Timeout waiting for Vite dev server to stabilize: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

async function cleanupAppArtifacts(appRoot, cleanupPaths) {
  if (!Array.isArray(cleanupPaths) || cleanupPaths.length === 0) {
    return
  }

  for (const cleanupPath of cleanupPaths) {
    if (!cleanupPath) {
      continue
    }
    try {
      await fs.rm(join(appRoot, cleanupPath), { recursive: true, force: true })
    }
    catch {
      // ignore cleanup errors for generated artifacts
    }
  }
}

async function main() {
  const cwd = process.cwd()
  const repoRoot = findRepoRoot(cwd)
  const rawArgs = process.argv.slice(2)
  const hasAppArg = rawArgs.length > 0 && !rawArgs[0].startsWith('-')
  const appArg = hasAppArg ? rawArgs[0] : undefined
  let extraArgs = hasAppArg ? rawArgs.slice(1) : rawArgs
  if (extraArgs[0] === '--') {
    extraArgs = extraArgs.slice(1)
  }
  const appName = detectAppName(repoRoot, cwd, appArg)
  const appRoot = join(repoRoot, 'apps', appName)
  const appConfig = getAppConfig(appName, repoRoot, appRoot)
  const viteLockPath = join(repoRoot, VITE_LOCK_NAME)

  let port = await getFreePort(BIND_HOST)
  let host = ACCESS_HOST
  let baseURL = `http://${host}:${port}`
  let readyUrl = new URL(appConfig.readyPath, baseURL).toString()
  let env = {
    ...process.env,
    ...appConfig.server.env,
    E2E: '1',
    PORT: String(port),
  }
  let devProcess
  const runErrors = []

  const buildDevArgs = (targetPort) => {
    const devArgs = [
      ...appConfig.server.args,
      ...(appConfig.server.command.includes('vitepress')
        ? ['--host', BIND_HOST, '--port', String(targetPort)]
        : []),
    ]

    if (appConfig.server.command.includes('vite') && !appConfig.server.command.includes('vitepress')) {
      devArgs.push('--host', BIND_HOST, '--port', String(targetPort))
    }

    if (appName === 'mokup-webpack-demo') {
      devArgs.push('--port', String(targetPort))
    }

    return devArgs
  }

  const describeAppRun = (command, args, targetBaseURL = baseURL, targetPort = port) => {
    return formatAppContext({
      appName,
      cwd: appRoot,
      url: targetBaseURL,
      port: targetPort,
      command: formatCommand(command, args),
    })
  }

  const startDevProcess = (runtimeEnv, targetPort) => {
    const devArgs = buildDevArgs(targetPort)
    const nextProcess = spawn(appConfig.server.command, devArgs, {
      cwd: appRoot,
      env: createCommandEnv(runtimeEnv),
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    nextProcess.stdout?.pipe(process.stdout)
    nextProcess.stderr?.pipe(process.stderr)
    return nextProcess
  }

  let preCommandsDone = false

  const onExit = () => {
    void stopProcess(devProcess).catch((error) => {
      process.stderr.write(`Failed to stop app dev server: ${String(error)}\n`)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', onExit)
  process.once('SIGTERM', onExit)

  const isVite
    = appConfig.server.command.includes('vite')
      && !appConfig.server.command.includes('vitepress')
  const maxViteStartAttempts = isVite ? 2 : 1

  try {
    for (let attempt = 1; attempt <= maxViteStartAttempts; attempt++) {
      if (attempt > 1) {
        port = await getFreePort(BIND_HOST)
        host = ACCESS_HOST
        baseURL = `http://${host}:${port}`
        readyUrl = new URL(appConfig.readyPath, baseURL).toString()
      }

      env = {
        ...process.env,
        ...appConfig.server.env,
        E2E: '1',
        PORT: String(port),
      }

      if (!preCommandsDone && appConfig.preCommands?.length) {
        for (const command of appConfig.preCommands) {
          try {
            await runChildProcess(command.command, command.args, {
              cwd: appRoot,
              env,
              stdio: 'inherit',
            })
          }
          catch (error) {
            throw new Error(
              `Pre-command failed (${describeAppRun(command.command, command.args)}): ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        preCommandsDone = true
      }

      let hasViteLock = false
      if (isVite) {
        await acquireLock(viteLockPath, DEFAULT_TIMEOUT_MS)
        hasViteLock = true
      }

      try {
        devProcess = startDevProcess(env, port)

        if (isVite) {
          const result = await waitForViteStable({
            child: devProcess,
            readyPath: appConfig.readyPath,
            timeoutMs: DEFAULT_TIMEOUT_MS,
            defaultBaseURL: baseURL,
          })
          baseURL = result.baseURL
          readyUrl = result.readyUrl
          const parsed = new URL(baseURL)
          host = parsed.hostname
        }
        else {
          await waitForReady({
            host,
            port,
            url: readyUrl,
            timeoutMs: DEFAULT_TIMEOUT_MS,
          })
        }
        break
      }
      catch (error) {
        try {
          await stopProcess(devProcess)
        }
        catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `App dev server startup and cleanup failed (${appName})`)
        }
        if (attempt >= maxViteStartAttempts) {
          throw new Error(
            `Failed to start app dev server (${describeAppRun(appConfig.server.command, buildDevArgs(port))}): ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        process.stderr.write(
          `Warning: Vite startup failed on attempt ${attempt} (${describeAppRun(appConfig.server.command, buildDevArgs(port))}), retrying once: ${error instanceof Error ? error.message : String(error)}\n`,
        )
      }
      finally {
        if (hasViteLock) {
          await releaseLock(viteLockPath)
        }
      }
    }

    const playwrightArgs = ['exec', 'playwright', 'test', ...extraArgs]
    try {
      await runChildProcess('pnpm', playwrightArgs, {
        cwd: appRoot,
        env: {
          ...env,
          E2E_BASE_URL: baseURL,
          E2E_PORT: String(new URL(baseURL).port || port),
          E2E_APP_NAME: appName,
        },
        stdio: 'inherit',
      })
    }
    catch (error) {
      throw new Error(
        `Playwright run failed (${describeAppRun('pnpm', playwrightArgs)}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  catch (error) {
    runErrors.push(error)
  }
  finally {
    process.off('SIGINT', onExit)
    process.off('SIGTERM', onExit)
    try {
      await stopProcess(devProcess)
    }
    catch (cleanupError) {
      runErrors.push(cleanupError)
    }
    finally {
      await cleanupAppArtifacts(appRoot, appConfig.cleanupPaths)
    }
  }
  if (runErrors.length > 1) {
    throw new AggregateError(runErrors, `App E2E run and server cleanup failed (${appName})`)
  }
  if (runErrors.length === 1) {
    throw runErrors[0]
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
