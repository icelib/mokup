import type { PreviewServer, ViteDevServer } from 'vite'

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cwd } from 'node:process'
import { fileURLToPath } from 'node:url'

import { createTsxConfigFile, loadModule as loadModuleShared } from '@mokup/shared/module-loader'
import { dirname, relative, resolve } from '@mokup/shared/pathe'
import { loadViteModule } from './vite-module-loader'

const sourceRoot = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(sourceRoot, '..')
const require = createRequire(import.meta.url)

function resolveWorkspaceEntry(candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function findWorkspaceRoot(start: string) {
  let current = start
  while (true) {
    const workspaceFile = resolve(current, 'pnpm-workspace.yaml')
    const turboFile = resolve(current, 'turbo.json')
    if (existsSync(workspaceFile) || existsSync(turboFile)) {
      return current
    }
    const parent = dirname(current)
    if (!parent || parent === current) {
      return null
    }
    current = parent
  }
}

function resolvePackageRoot(name: string) {
  try {
    return dirname(require.resolve(`${name}/package.json`))
  }
  catch {
    return null
  }
}

const resolvedMokupRoot = resolvePackageRoot('mokup')
const workspaceMokupRoot = resolve(packageRoot, '../mokup')
const cwdWorkspaceRoot = findWorkspaceRoot(cwd())
const cwdMokupRoot = cwdWorkspaceRoot ? resolve(cwdWorkspaceRoot, 'packages/mokup') : null

const mokupSourceEntry = resolveWorkspaceEntry([
  resolvedMokupRoot ? resolve(resolvedMokupRoot, 'src/index.ts') : null,
  resolve(workspaceMokupRoot, 'src/index.ts'),
  cwdMokupRoot ? resolve(cwdMokupRoot, 'src/index.ts') : null,
])
const mokupViteSourceEntry = resolveWorkspaceEntry([
  resolvedMokupRoot ? resolve(resolvedMokupRoot, 'src/vite.ts') : null,
  resolve(workspaceMokupRoot, 'src/vite.ts'),
  cwdMokupRoot ? resolve(cwdMokupRoot, 'src/vite.ts') : null,
])

function toTsxConfigPath(file: string) {
  const rel = relative(packageRoot, file)
  return rel.startsWith('.') ? rel : `./${rel}`
}

function buildTsxConfigPath() {
  const paths: Record<string, string[]> = {}
  if (mokupSourceEntry) {
    paths['mokup'] = [toTsxConfigPath(mokupSourceEntry)]
  }
  if (mokupViteSourceEntry) {
    paths['mokup/vite'] = [toTsxConfigPath(mokupViteSourceEntry)]
  }
  if (Object.keys(paths).length === 0) {
    return null
  }
  return createTsxConfigFile({
    baseUrl: packageRoot,
    paths,
  })
}

const tsxConfigPath = buildTsxConfigPath()

async function loadModule(file: string) {
  return loadModuleShared(file, { tsconfigPath: tsxConfigPath })
}

async function loadModuleWithVite(server: ViteDevServer | PreviewServer, file: string) {
  const asDevServer = server as ViteDevServer
  if ('ssrLoadModule' in asDevServer) {
    try {
      return await loadViteModule(asDevServer, file)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('transport was disconnected')) {
        return loadModule(file)
      }
      throw error
    }
  }
  return loadModule(file)
}

export { loadModule, loadModuleWithVite }
