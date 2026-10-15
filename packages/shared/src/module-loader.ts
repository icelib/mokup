import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { isTypeScriptModule } from './module-format'
import { extname, resolve } from './pathe'
import { ensureTsxCommonJsRegister, resetTsxCommonJsForTests, syncTsxCommonJsConfig } from './tsx-commonjs'

interface TsxConfigOptions {
  baseUrl: string
  paths: Record<string, string[]>
  fileName?: string
}

export function createTsxConfigFile(options: TsxConfigOptions) {
  const config = {
    compilerOptions: {
      baseUrl: options.baseUrl,
      paths: options.paths,
    },
  }
  const configPath = options.fileName ?? resolve(tmpdir(), `mokup-tsx-${process.pid}.json`)
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return configPath
}

let sourceMapsEnabled = false
let tsxRegisterPromise: Promise<void> | null = null
let tsxRegisteredConfig: string | null = null

export function resetModuleLoaderForTests() {
  resetTsxCommonJsForTests()
  sourceMapsEnabled = false
  tsxRegisterPromise = null
  tsxRegisteredConfig = null
}

function ensureSourceMapsEnabled() {
  if (sourceMapsEnabled) {
    return
  }
  const setSourceMapsEnabled = (process as {
    setSourceMapsEnabled?: (enabled: boolean) => void
  }).setSourceMapsEnabled
  if (typeof setSourceMapsEnabled === 'function') {
    setSourceMapsEnabled(true)
  }
  sourceMapsEnabled = true
}

export async function ensureTsxRegister(tsconfigPath?: string | null) {
  const desired = tsconfigPath ?? null
  if (tsxRegisterPromise) {
    await tsxRegisterPromise
    if (desired && tsxRegisteredConfig !== desired) {
      tsxRegisterPromise = (async () => {
        ensureSourceMapsEnabled()
        const { register } = await import('tsx/esm/api')
        register({ tsconfig: desired })
        syncTsxCommonJsConfig(desired)
        tsxRegisteredConfig = desired
      })()
      await tsxRegisterPromise
    }
    return tsxRegisterPromise
  }
  tsxRegisterPromise = (async () => {
    ensureSourceMapsEnabled()
    const { register } = await import('tsx/esm/api')
    if (desired) {
      register({ tsconfig: desired })
      tsxRegisteredConfig = desired
    }
    else {
      register()
      tsxRegisteredConfig = null
    }
  })()
  return tsxRegisterPromise
}

export async function loadModule(
  file: string,
  options?: { tsconfigPath?: string | null },
) {
  const ext = extname(file).toLowerCase()
  if (ext === '.cjs') {
    const require = createRequire(import.meta.url)
    const resolved = require.resolve(file)
    delete require.cache[resolved]
    return require(resolved)
  }
  if (ext === '.ts') {
    await ensureTsxRegister(options?.tsconfigPath ?? null)
    const require = createRequire(import.meta.url)
    const resolved = require.resolve(file)
    if (!isTypeScriptModule(resolved)) {
      ensureTsxCommonJsRegister(tsxRegisteredConfig)
      // CJS imports use the resolved filename as their identity, not URL queries.
      // Refresh only the entry so its dependencies retain their shared state.
      delete require.cache[resolved]
      return require(resolved)
    }
  }
  if (ext === '.js' || ext === '.mjs' || ext === '.ts') {
    // Each evaluation needs its own identity, including across loader instances and clock resets.
    return import(`${pathToFileURL(file).href}?t=${randomUUID()}`)
  }
  return null
}
