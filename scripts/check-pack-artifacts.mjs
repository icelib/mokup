import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'

const rootDir = process.cwd()
const tempPackDir = path.join(rootDir, '.tmp', 'release-pack')
const allowedRootFiles = new Set([
  'package.json',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
])

function isLibraryPackage(pkg) {
  return Boolean(pkg.exports || pkg.types || pkg.main || pkg.module)
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function listPublishablePackages() {
  const packagesDir = path.join(rootDir, 'packages')
  const entries = await fs.readdir(packagesDir, { withFileTypes: true })
  const packages = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const packageDir = path.join(packagesDir, entry.name)
    const packageJsonFile = path.join(packageDir, 'package.json')
    const pkg = await readJson(packageJsonFile)
    if (pkg.private === true) {
      continue
    }
    packages.push({
      dir: packageDir,
      name: pkg.name,
      manifest: pkg,
    })
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name))
}

function normalizePackJson(stdout) {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return []
  }
  const parsed = JSON.parse(trimmed)
  return Array.isArray(parsed) ? parsed : [parsed]
}

function collectDeclaredTargets(value, targets) {
  if (typeof value === 'string') {
    targets.add(value.replace(/^\.\//, ''))
  }
  else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      collectDeclaredTargets(child, targets)
    }
  }
}

function matchesDeclaredTarget(target, files) {
  if (!target.includes('*')) {
    return files.has(target)
  }
  const pattern = target.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  const matcher = new RegExp(`^${pattern}$`)
  return [...files].some(file => matcher.test(file))
}

function getPackViolations(pkg, files, playgroundHtml = '') {
  const violations = []
  const pkgName = pkg.name
  const paths = files
    .map(entry => entry?.path)
    .filter(pathname => typeof pathname === 'string')

  if (!paths.includes('package.json')) {
    violations.push(`${pkgName}: tarball must include package.json`)
  }
  const packedPaths = new Set(paths)
  if (isLibraryPackage(pkg) && !paths.some(file => file.endsWith('.mjs'))) {
    violations.push(`${pkgName}: tarball must include at least one .mjs entry`)
  }

  const declaredTargets = new Set()
  for (const field of ['exports', 'types', 'typesVersions', 'main', 'module', 'bin']) {
    collectDeclaredTargets(pkg[field], declaredTargets)
  }
  for (const target of declaredTargets) {
    if (!matchesDeclaredTarget(target, packedPaths)) {
      violations.push(`${pkgName}: declared entry "${target}" is missing from the tarball`)
    }
  }

  if (pkgName === '@mokup/playground') {
    for (const required of ['dist/index.html', 'dist/assets/playground.js']) {
      if (!packedPaths.has(required)) {
        violations.push(`${pkgName}: tarball must include ${required}`)
      }
    }
    if (!playgroundHtml.trim()) {
      violations.push(`${pkgName}: dist/index.html must contain the playground document`)
    }
    for (const match of playgroundHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
      const reference = match[1]
      if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) {
        continue
      }
      const asset = path.posix.normalize(path.posix.join('dist', reference.split(/[?#]/)[0]))
      if (!packedPaths.has(asset)) {
        violations.push(`${pkgName}: index.html asset "${asset}" is missing from the tarball`)
      }
    }
  }

  for (const file of paths) {
    const topLevel = file.split('/')[0] ?? ''
    if (topLevel !== 'dist' && !allowedRootFiles.has(file)) {
      violations.push(`${pkgName}: unexpected packed file "${file}"`)
      continue
    }
    if (file.endsWith('.cjs') || file.endsWith('.cts')) {
      violations.push(`${pkgName}: packed file "${file}" breaks the ESM-only contract`)
    }
  }

  return violations
}

async function packWorkspacePackage(pkg) {
  const { stdout } = await execa(
    'pnpm',
    [
      '--filter',
      pkg.name,
      'pack',
      '--json',
      '--pack-destination',
      tempPackDir,
    ],
    {
      cwd: rootDir,
      env: process.env,
      maxBuffer: 1024 * 1024,
      stripFinalNewline: false,
    },
  )
  return normalizePackJson(stdout)
}

async function main() {
  await fs.rm(tempPackDir, { force: true, recursive: true })
  await fs.mkdir(tempPackDir, { recursive: true })

  const packages = await listPublishablePackages()
  const violations = []

  try {
    for (const pkg of packages) {
      const results = await packWorkspacePackage(pkg)
      if (results.length === 0) {
        violations.push(`${pkg.name}: pnpm pack returned no JSON output`)
        continue
      }
      const playgroundHtml = pkg.name === '@mokup/playground'
        ? await fs.readFile(path.join(pkg.dir, 'dist/index.html'), 'utf8').catch(() => '')
        : ''
      for (const result of results) {
        violations.push(...getPackViolations(pkg.manifest, result.files ?? [], playgroundHtml))
      }
    }
  }
  finally {
    await fs.rm(tempPackDir, { force: true, recursive: true })
  }

  if (violations.length > 0) {
    process.stderr.write(`${violations.map(entry => `- ${entry}`).join('\n')}\n`)
    process.exit(1)
  }

  process.stdout.write(`pack artifacts ok (${packages.length} packages checked)\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`pack artifact check failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exit(1)
  })
}

export { getPackViolations }
