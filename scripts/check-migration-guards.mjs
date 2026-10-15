import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { minVersion, validRange } from 'semver'
import YAML from 'yaml'

const rootDir = process.cwd()
const catalogBuildDependencies = ['rolldown', 'tsdown']
const allowedScanExtensions = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
  '.md',
  '.json',
  '.yaml',
  '.yml',
])
const skipDirs = new Set([
  '.git',
  '.turbo',
  '.wrangler',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'plans',
  'test',
  'test-results',
])
const skipFiles = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])
const scanRoots = ['apps', 'packages', 'scripts', '.github', 'docs']
const skippedScanFiles = new Set([
  'scripts/check-migration-guards.mjs',
])
const allowedLegacyDocFiles = new Set([
  'apps/mokup-docs/docs/getting-started/upgrade-to-v1.md',
  'apps/mokup-docs/docs/zh/getting-started/upgrade-to-v1.md',
  'docs/guide/migration-v1.md',
])
const SHARED_ESBUILD_IMPORT_RE = /@mokup\/shared\/esbuild/
const SHARED_ESBUILD_FROM_RE = /from\s+['"]@mokup\/shared\/esbuild['"]/
const SHARED_ESBUILD_DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]@mokup\/shared\/esbuild['"]\s*\)/
const SHARED_ESBUILD_REQUIRE_RE = /require\s*\(\s*['"]@mokup\/shared\/esbuild['"]\s*\)/
const DIRECT_ESBUILD_IMPORT_RE = /from\s+['"]esbuild['"]/
const DIRECT_ESBUILD_DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]esbuild['"]\s*\)/
const DIRECT_ESBUILD_REQUIRE_RE = /require\s*\(\s*['"]esbuild['"]\s*\)/
const LEGACY_TSUP_RE = /\btsup\b/
const LEGACY_UNBUILD_RE = /\bunbuild\b/
const LEGACY_BUILD_CONFIG_RE = /\bbuild\.config\.(?:ts|js|mjs|mts|cjs|cts)\b/
const DOC_REQUIRE_MOKUP_RE = /require\s*\(\s*['"]mokup(?:\/[^'"]+)?['"]\s*\)/
const DOC_MODULE_EXPORTS_RE = /\bmodule\.exports\b/
const forbiddenContentRules = [
  {
    id: 'shared-esbuild-entry',
    test: content =>
      SHARED_ESBUILD_IMPORT_RE.test(content)
      && (
        SHARED_ESBUILD_FROM_RE.test(content)
        || SHARED_ESBUILD_DYNAMIC_IMPORT_RE.test(content)
        || SHARED_ESBUILD_REQUIRE_RE.test(content)
      ),
    message: 'Use @mokup/shared/rolldown instead of the removed @mokup/shared/esbuild entry.',
  },
  {
    id: 'direct-esbuild-import',
    test: content =>
      DIRECT_ESBUILD_IMPORT_RE.test(content)
      || DIRECT_ESBUILD_DYNAMIC_IMPORT_RE.test(content)
      || DIRECT_ESBUILD_REQUIRE_RE.test(content),
    message: 'Direct esbuild imports are forbidden in repository code and config.',
  },
  {
    id: 'legacy-tsup-config',
    test: content =>
      LEGACY_TSUP_RE.test(content)
      || LEGACY_UNBUILD_RE.test(content)
      || LEGACY_BUILD_CONFIG_RE.test(content),
    message: 'Legacy tsup/unbuild build-chain references are forbidden outside migration docs.',
  },
]

function getContentViolations(relativePath, content) {
  const relativeFile = relativePath.replaceAll('\\', '/')
  const violations = []
  const isAllowedLegacyDoc = allowedLegacyDocFiles.has(relativeFile)
  const isChangelog = path.basename(relativeFile) === 'CHANGELOG.md'
  const isPublicDoc = relativeFile.endsWith('.md')
    && (
      relativeFile.startsWith('apps/mokup-docs/docs/')
      || relativeFile.startsWith('docs/guide/')
    )
    && !relativeFile.includes('/blog/')
    && !relativeFile.endsWith('.draft.md')
    && !relativeFile.startsWith('.changeset/')

  if (!isAllowedLegacyDoc && !isChangelog) {
    for (const rule of forbiddenContentRules) {
      if (rule.test(content)) {
        violations.push(`${relativeFile}: ${rule.message}`)
      }
    }
  }

  if (isPublicDoc && !isAllowedLegacyDoc) {
    if (DOC_REQUIRE_MOKUP_RE.test(content)) {
      violations.push(`${relativeFile}: public docs must use ESM import examples for published mokup packages`)
    }
    if (DOC_MODULE_EXPORTS_RE.test(content)) {
      violations.push(`${relativeFile}: public docs must use ESM config examples instead of module.exports`)
    }
  }
  return violations
}

function toRelative(file) {
  return path.relative(rootDir, file).split(path.sep).join('/')
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function pathExists(file) {
  try {
    await fs.access(file)
    return true
  }
  catch {
    return false
  }
}

function shouldSkipPath(file) {
  const relative = toRelative(file)
  if (!relative || relative === '..' || relative.startsWith('../')) {
    return true
  }
  if (skippedScanFiles.has(relative)) {
    return true
  }
  if (skipFiles.has(path.basename(file))) {
    return true
  }
  return relative.split('/').some(segment => skipDirs.has(segment))
}

async function walk(dir, files) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) {
        continue
      }
      await walk(file, files)
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    if (shouldSkipPath(file)) {
      continue
    }
    if (!allowedScanExtensions.has(path.extname(file))) {
      continue
    }
    files.push(file)
  }
}

function isPublishablePackageJson(relativeFile, pkg) {
  return relativeFile.startsWith('packages/') && pkg.private !== true
}

function isLibraryPackage(pkg) {
  return Boolean(pkg.exports || pkg.types || pkg.main || pkg.module)
}

function collectExportTargets(value, targets) {
  if (typeof value === 'string') {
    targets.push(value)
    return
  }
  if (!value || typeof value !== 'object') {
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'require') {
      targets.push('__require_condition__')
      continue
    }
    collectExportTargets(child, targets)
  }
}

function checkPackageExports(relativeFile, pkg, violations) {
  const targets = []
  collectExportTargets(pkg.exports, targets)
  if (targets.includes('__require_condition__')) {
    violations.push(`${relativeFile}: publishable packages must not expose a require export condition`)
  }
  for (const target of targets) {
    if (target === '__require_condition__') {
      continue
    }
    if (typeof target !== 'string') {
      continue
    }
    if (target.endsWith('.cjs') || target.endsWith('.cts') || target.endsWith('.js')) {
      violations.push(`${relativeFile}: export target "${target}" must stay ESM-only`)
    }
  }
}

function checkPackageScripts(relativeFile, pkg, violations) {
  if (!isLibraryPackage(pkg)) {
    return
  }
  const buildScript = pkg.scripts?.build
  if (buildScript !== 'tsdown') {
    violations.push(`${relativeFile}: publishable package build script must be "tsdown"`)
  }
  const devScript = pkg.scripts?.dev
  if (typeof devScript === 'string' && !devScript.startsWith('tsdown --watch')) {
    violations.push(`${relativeFile}: publishable package dev script must use "tsdown --watch"`)
  }
}

function checkPackageDeps(relativeFile, pkg, violations) {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[field]
    if (!deps || typeof deps !== 'object') {
      continue
    }
    for (const depName of Object.keys(deps)) {
      if (depName === 'esbuild' || depName === 'tsup' || depName === 'unbuild') {
        violations.push(`${relativeFile}: publishable package must not depend on ${depName}`)
      }
    }
  }
}

function checkPackageMeta(relativeFile, pkg, expectedNodeRange, violations) {
  if (pkg.type !== 'module') {
    violations.push(`${relativeFile}: publishable package type must be "module"`)
  }
  if (expectedNodeRange && pkg.engines?.node !== expectedNodeRange) {
    violations.push(`${relativeFile}: publishable package engines.node must be "${expectedNodeRange}"`)
  }
}

function isVersionRange(value) {
  if (typeof value !== 'string' || value.trim() === '' || validRange(value) === null) {
    return false
  }
  const minimum = minVersion(value)
  return minimum !== null && minimum.version !== '0.0.0'
}

function checkBuildCatalog(input, violations) {
  const catalog = input.workspace?.catalog ?? input.workspace?.catalogs?.default
  for (const name of catalogBuildDependencies) {
    if (!isVersionRange(catalog?.[name])) {
      violations.push(`pnpm-workspace.yaml: default catalog.${name} must be a valid, bounded version range`)
    }
  }
  const packageEntries = [{ file: 'package.json', pkg: input.rootPackage }, ...input.packageEntries]
  for (const { file, pkg } of packageEntries) {
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const name of catalogBuildDependencies) {
        if (pkg[field]?.[name] !== undefined && pkg[field][name] !== 'catalog:') {
          violations.push(`${file}: ${field}.${name} must use "catalog:"`)
        }
      }
    }
  }
  if (input.rootPackage.devDependencies?.tsdown === undefined) {
    violations.push('package.json: devDependencies.tsdown must use "catalog:"')
  }
  const sharedPackage = input.packageEntries.find(entry => entry.file === 'packages/shared/package.json')?.pkg
  if (sharedPackage?.dependencies?.rolldown === undefined) {
    violations.push('packages/shared/package.json: dependencies.rolldown must use "catalog:"')
  }
  if (input.rootPackage.pnpm?.overrides?.rolldown !== undefined || input.workspace?.overrides?.rolldown !== undefined) {
    violations.push('Rolldown must not use a blanket override; let each build tool resolve its compatible dependency')
  }
}

function evaluateMigrationGuards(rawInput) {
  const input = {
    ...rawInput,
    packageEntries: rawInput.packageEntries.map(entry => ({ ...entry, file: entry.file.replaceAll('\\', '/') })),
  }
  const violations = []
  const developmentNodeRange = input.rootPackage.engines?.node
  const runtimeNodeRange = input.packageEntries.find(entry => entry.file === 'packages/runtime/package.json')?.pkg.engines?.node

  if (!isVersionRange(developmentNodeRange)) {
    violations.push('package.json: root engines.node must declare a valid, bounded development Node range')
  }
  if (!isVersionRange(runtimeNodeRange)) {
    violations.push('packages/runtime/package.json: engines.node must declare a valid, bounded published runtime Node range')
  }
  checkBuildCatalog(input, violations)

  for (const entry of input.scanEntries) {
    violations.push(...getContentViolations(entry.file, entry.content))
  }

  for (const entry of input.packageEntries) {
    if (entry.pkg.private === true && entry.pkg.engines?.node !== developmentNodeRange) {
      violations.push(`${entry.file}: private package engines.node must match root engines.node "${developmentNodeRange}"`)
    }
    if (!isPublishablePackageJson(entry.file, entry.pkg)) {
      continue
    }
    checkPackageMeta(entry.file, entry.pkg, runtimeNodeRange, violations)
    checkPackageScripts(entry.file, entry.pkg, violations)
    checkPackageDeps(entry.file, entry.pkg, violations)
    checkPackageExports(entry.file, entry.pkg, violations)
  }

  return violations.sort((a, b) => a.localeCompare(b))
}

async function main() {
  const packageJsonFiles = []
  const scanFiles = []

  for (const rootName of scanRoots) {
    const dir = path.join(rootDir, rootName)
    if (await pathExists(dir)) {
      await walk(dir, scanFiles)
    }
  }

  const packageDirs = [
    path.join(rootDir, 'packages'),
    path.join(rootDir, 'apps'),
  ]
  for (const dir of packageDirs) {
    if (!await pathExists(dir)) {
      continue
    }
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      const packageJsonFile = path.join(dir, entry.name, 'package.json')
      if (await pathExists(packageJsonFile)) {
        packageJsonFiles.push(packageJsonFile)
      }
    }
  }

  const rootPackage = await readJson(path.join(rootDir, 'package.json'))
  const workspace = YAML.parse(await fs.readFile(path.join(rootDir, 'pnpm-workspace.yaml'), 'utf8'))
  const scanEntries = await Promise.all(
    scanFiles.map(async (file) => {
      return {
        file: toRelative(file),
        content: await fs.readFile(file, 'utf8'),
      }
    }),
  )
  const packageEntries = await Promise.all(
    packageJsonFiles.map(async (file) => {
      return {
        file: toRelative(file),
        pkg: await readJson(file),
      }
    }),
  )
  const violations = evaluateMigrationGuards({
    packageEntries,
    rootPackage,
    scanEntries,
    workspace,
  })

  if (violations.length > 0) {
    const formatted = violations
      .map(entry => `- ${entry}`)
      .join('\n')
    process.stderr.write(`migration guards failed:\n${formatted}\n`)
    process.exit(1)
  }

  process.stdout.write(`migration guards ok (${packageJsonFiles.length} package.json files checked)\n`)
}

if (isDirectExecution()) {
  main().catch((error) => {
    process.stderr.write(`migration guards failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exit(1)
  })
}

export {
  evaluateMigrationGuards,
}
function isDirectExecution() {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  return import.meta.url === pathToFileURL(entry).href
}
