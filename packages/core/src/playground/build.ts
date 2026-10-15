import type { RouteIgnoreInfo, RouteSkipInfo } from '../scanner'
import type { Logger, RouteTable } from '../shared/types'
import type { PlaygroundDistResolver } from './assets'
import { promises as fs } from 'node:fs'
import { relative, sep } from 'node:path'
import { isInDirs, normalizePathForComparison } from '@mokup/shared/path-utils'
import { join, normalize, resolve } from '@mokup/shared/pathe'
import { resolvePlaygroundDist } from './assets'
import { normalizeBase, normalizePlaygroundPath, resolvePlaygroundRequestPath } from './config'
import { resolveGroupRoot, resolveGroups } from './grouping'
import { injectPlaygroundSw } from './inject'
import {
  toPlaygroundConfigFile,
  toPlaygroundDisabledRoute,
  toPlaygroundIgnoredRoute,
  toPlaygroundRoute,
} from './serialize'

const LEADING_SLASH_RE = /^\/+/
const SW_LIFECYCLE_SCRIPT_RE = /<script[^>]*mokup-sw-lifecycle\.js[^>]*><\/script>\s*/gi

interface PlaygroundBuildParams {
  outDir: string
  base: string
  playgroundPath: string
  root?: string
  routes: RouteTable
  disabledRoutes: RouteSkipInfo[]
  ignoredRoutes: RouteIgnoreInfo[]
  configFiles: { file: string }[]
  disabledConfigFiles: { file: string }[]
  dirs: string[]
  swScript: string | null
  logger: Logger
  resolvePlaygroundDist?: PlaygroundDistResolver
}

function resolvePlaygroundOutDir(outDir: string, base: string, playgroundPath: string) {
  const normalizedBase = normalizeBase(base)
  const normalized = normalizePlaygroundPath(playgroundPath)
  // Vite removes the public base before looking up files in its output root.
  const outputPath = normalizedBase && (normalized === normalizedBase || normalized.startsWith(`${normalizedBase}/`))
    ? normalized.slice(normalizedBase.length)
    : normalized
  const trimmed = outputPath.replace(LEADING_SLASH_RE, '')
  return trimmed ? join(outDir, normalize(trimmed)) : outDir
}

async function hasOutputSymlink(outDir: string, targetDir: string) {
  let current = outDir
  for (const segment of relative(outDir, targetDir).split(sep)) {
    current = join(current, segment)
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        return true
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw error
    }
  }
  return false
}

function stripSwLifecycle(html: string) {
  return html.replace(SW_LIFECYCLE_SCRIPT_RE, '')
}

async function writeRoutesPayload(params: PlaygroundBuildParams, targetDir: string) {
  const baseRoot = resolveGroupRoot(params.dirs, params.root)
  const groups = resolveGroups(params.dirs, baseRoot)
  const basePath = resolvePlaygroundRequestPath(params.base, params.playgroundPath)
  const payload = {
    basePath,
    root: baseRoot,
    count: params.routes.length,
    groups: groups.map(group => ({ key: group.key, label: group.label })),
    routes: params.routes.map(route => toPlaygroundRoute(route, baseRoot, groups)),
    disabled: params.disabledRoutes.map(route =>
      toPlaygroundDisabledRoute(route, baseRoot, groups),
    ),
    ignored: params.ignoredRoutes.map(route =>
      toPlaygroundIgnoredRoute(route, baseRoot, groups),
    ),
    configs: params.configFiles.map(entry => toPlaygroundConfigFile(entry, baseRoot, groups)),
    disabledConfigs: params.disabledConfigFiles.map(entry =>
      toPlaygroundConfigFile(entry, baseRoot, groups),
    ),
  }
  await fs.writeFile(
    join(targetDir, 'routes'),
    JSON.stringify(payload, null, 2),
    'utf8',
  )
}

async function updateIndexHtml(targetDir: string, swScript: string | null) {
  const indexPath = join(targetDir, 'index.html')
  const html = await fs.readFile(indexPath, 'utf8')
  const cleaned = stripSwLifecycle(html)
  const output = swScript ? injectPlaygroundSw(cleaned, swScript) : cleaned
  await fs.writeFile(indexPath, output, 'utf8')
}

async function removeLegacySwAsset(targetDir: string) {
  const legacyFiles = [
    join(targetDir, 'assets', 'mokup-sw-lifecycle.js'),
    join(targetDir, 'assets', 'mokup-sw-lifecycle.js.map'),
  ]
  await Promise.all(legacyFiles.map(file => fs.rm(file, { force: true })))
}

export async function writePlaygroundBuild(params: PlaygroundBuildParams) {
  const distDir = resolvePlaygroundDist(params.resolvePlaygroundDist)
  const outDir = resolve(params.outDir)
  const targetDir = resolvePlaygroundOutDir(outDir, params.base, params.playgroundPath)
  if (normalizePathForComparison(targetDir) === normalizePathForComparison(outDir)
    || !isInDirs(targetDir, [outDir])) {
    params.logger.error('Playground build path must be a strict subdirectory of the Vite outDir. Aborting output.')
    return
  }
  // The configured output root may be a symlink. Its descendants must not
  // redirect the recursive removal or copy outside that root.
  if (await hasOutputSymlink(outDir, targetDir)) {
    params.logger.error('Playground build path contains a symbolic link below the Vite outDir. Aborting output.')
    return
  }

  try {
    await fs.stat(distDir)
  }
  catch (error) {
    params.logger.error('Failed to locate playground assets:', error)
    return
  }

  await fs.rm(targetDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })
  await fs.cp(distDir, targetDir, { recursive: true })

  await removeLegacySwAsset(targetDir)
  await updateIndexHtml(targetDir, params.swScript)
  await writeRoutesPayload(params, targetDir)
}
