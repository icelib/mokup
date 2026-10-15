import { createRequire } from 'node:module'
import process from 'node:process'

let unregister: (() => void) | undefined
let registeredConfig: string | null = null

export function resetTsxCommonJsForTests() {
  unregister?.()
  unregister = undefined
  registeredConfig = null
}

export function ensureTsxCommonJsRegister(tsconfigPath?: string | null) {
  const desired = tsconfigPath ?? null
  if (unregister && (!desired || registeredConfig === desired)) {
    return
  }
  const { register } = createRequire(import.meta.url)('tsx/cjs/api') as typeof import('tsx/cjs/api')
  const previous = process.env['TSX_TSCONFIG_PATH']
  try {
    // The CJS API reads its config synchronously from the environment. Never
    // leave this override in place across an await or while evaluating user code.
    if (desired) {
      process.env['TSX_TSCONFIG_PATH'] = desired
    }
    const next = register()
    unregister?.()
    unregister = next
    registeredConfig = desired
  }
  finally {
    if (previous === undefined) {
      delete process.env['TSX_TSCONFIG_PATH']
    }
    else {
      process.env['TSX_TSCONFIG_PATH'] = previous
    }
  }
}

export function syncTsxCommonJsConfig(tsconfigPath: string | null) {
  if (unregister) {
    ensureTsxCommonJsRegister(tsconfigPath)
  }
}
