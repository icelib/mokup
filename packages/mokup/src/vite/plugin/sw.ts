import type { resolveSwConfig, resolveSwUnregisterConfig } from '../../internal/core'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSwRegistrationScript } from '../../shared/sw-registration-script'

interface SwResolveContext {
  resolve: (id: string) => Promise<{ id: string } | null>
}

const swModuleCandidates = [
  'dist/sw.mjs',
  'dist/sw.js',
  'src/sw.ts',
  'src/sw.js',
]

function resolvePackageRoot() {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  let current = moduleDir
  for (let index = 0; index < 6; index += 1) {
    if (existsSync(resolve(current, 'package.json'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }
  return moduleDir
}

const localSwModulePath = (() => {
  const packageRoot = resolvePackageRoot()
  for (const candidate of swModuleCandidates) {
    const filePath = resolve(packageRoot, candidate)
    if (existsSync(filePath)) {
      return filePath
    }
  }
  return resolve(packageRoot, 'src/sw.ts')
})()

async function resolveSwModuleImport(context: SwResolveContext) {
  const resolved = await context.resolve('mokup/sw')
  if (resolved?.id) {
    return resolved.id
  }
  const fallbackResolved = await context.resolve(localSwModulePath)
  if (fallbackResolved?.id) {
    return fallbackResolved.id
  }
  return localSwModulePath
}

function buildSwLifecycleScript(params: {
  importPath: string
  swConfig: ReturnType<typeof resolveSwConfig>
  unregisterConfig: ReturnType<typeof resolveSwUnregisterConfig>
  hasSwEntries: boolean
  hasSwRoutes: boolean
  resolveRequestPath: (path: string) => string
  resolveRegisterScope: (scope: string) => string
}) {
  const {
    importPath,
    swConfig,
    unregisterConfig,
    hasSwRoutes,
    resolveRequestPath,
    resolveRegisterScope,
  } = params
  const shouldUnregister = unregisterConfig.unregister === true
  if (shouldUnregister) {
    const path = resolveRequestPath(unregisterConfig.path)
    const scope = resolveRegisterScope(unregisterConfig.scope)
    return [
      `import { unregisterMokupServiceWorker } from ${JSON.stringify(importPath)}`,
      '(async () => {',
      `  await unregisterMokupServiceWorker({ path: ${JSON.stringify(path)}, scope: ${JSON.stringify(scope)} })`,
      '})()',
    ].join('\n')
  }
  if (!swConfig || swConfig.register === false) {
    return null
  }
  if (!hasSwRoutes) {
    return null
  }
  const path = resolveRequestPath(swConfig.path)
  const scope = resolveRegisterScope(swConfig.scope)
  return buildSwRegistrationScript(importPath, path, scope)
}

function buildSwLifecycleInlineScript(params: {
  swConfig: ReturnType<typeof resolveSwConfig>
  unregisterConfig: ReturnType<typeof resolveSwUnregisterConfig>
  hasSwEntries: boolean
  hasSwRoutes: boolean
  resolveRequestPath: (path: string) => string
  resolveRegisterScope: (scope: string) => string
}) {
  const {
    swConfig,
    unregisterConfig,
    hasSwRoutes,
    resolveRequestPath,
    resolveRegisterScope,
  } = params
  const shouldUnregister = unregisterConfig.unregister === true
  if (shouldUnregister) {
    const path = resolveRequestPath(unregisterConfig.path)
    const scope = resolveRegisterScope(unregisterConfig.scope)
    return [
      '(async () => {',
      '  if (typeof window === \'undefined\' || !(\'serviceWorker\' in navigator)) {',
      '    return',
      '  }',
      `  const path = ${JSON.stringify(path)}`,
      `  const scope = ${JSON.stringify(scope)}`,
      '  const origin = window.location.origin',
      '  const normalizeScope = (value) => {',
      '    const url = new URL(value, origin)',
      '    if (!url.pathname.endsWith(\'/\')) {',
      '      url.pathname = url.pathname + \'/\'',
      '    }',
      '    return url.href',
      '  }',
      '  const pathUrl = new URL(path, origin)',
      '  const scopeUrl = normalizeScope(scope)',
      '  const matchesScript = (scriptUrl) => {',
      '    if (!scriptUrl) {',
      '      return false',
      '    }',
      '    try {',
      '      const parsed = new URL(scriptUrl)',
      '      return parsed.origin === origin && parsed.pathname === pathUrl.pathname',
      '    }',
      '    catch {',
      '      return false',
      '    }',
      '  }',
      '  try {',
      '    const registrations = await navigator.serviceWorker.getRegistrations()',
      '    for (const registration of registrations) {',
      '      if (registration.scope !== scopeUrl) {',
      '        continue',
      '      }',
      '      const scriptUrls = [',
      '        registration.active?.scriptURL,',
      '        registration.waiting?.scriptURL,',
      '        registration.installing?.scriptURL,',
      '      ]',
      '      if (scriptUrls.some(matchesScript)) {',
      '        await registration.unregister()',
      '      }',
      '    }',
      '  }',
      '  catch (error) {',
      '    console.warn(\'Failed to unregister service worker:\', error)',
      '  }',
      '})()',
    ].join('\n')
  }
  if (!swConfig || swConfig.register === false) {
    return null
  }
  if (!hasSwRoutes) {
    return null
  }
  const path = resolveRequestPath(swConfig.path)
  const scope = resolveRegisterScope(swConfig.scope)
  return [
    '(async () => {',
    '  if (typeof window === \'undefined\' || !(\'serviceWorker\' in navigator)) {',
    '    return',
    '  }',
    `  const path = ${JSON.stringify(path)}`,
    `  const scope = ${JSON.stringify(scope)}`,
    '  try {',
    '    await navigator.serviceWorker.register(path, { type: \'module\', scope })',
    '  }',
    '  catch (error) {',
    '    console.warn(\'Failed to register service worker:\', error)',
    '  }',
    '})()',
  ].join('\n')
}

export type { SwResolveContext }
export { buildSwLifecycleInlineScript, buildSwLifecycleScript, resolveSwModuleImport }
