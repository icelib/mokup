import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const rootDir = process.cwd()
const tempPackDir = path.join(rootDir, '.tmp', 'release-pack')
const allowedRootFiles = new Set([
  'package.json',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
])

function isLibraryPackage(pkg) {
  return !pkg.private && Boolean(pkg.exports || pkg.types || pkg.main || pkg.module)
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
    if (!isLibraryPackage(pkg)) {
      continue
    }
    packages.push({
      dir: packageDir,
      name: pkg.name,
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

function getPackViolations(pkgName, files) {
  const violations = []
  const paths = files
    .map(entry => entry?.path)
    .filter(pathname => typeof pathname === 'string')

  if (!paths.includes('package.json')) {
    violations.push(`${pkgName}: tarball must include package.json`)
  }
  if (!paths.some(file => file.endsWith('.mjs'))) {
    violations.push(`${pkgName}: tarball must include at least one .mjs entry`)
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
  const { stdout } = await execFileAsync(
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
      for (const result of results) {
        violations.push(...getPackViolations(pkg.name, result.files ?? []))
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

main().catch((error) => {
  process.stderr.write(`pack artifact check failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
