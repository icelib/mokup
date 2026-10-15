import type { ManifestResponse } from '@mokup/runtime'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'

import { build as rolldown } from '@mokup/shared/rolldown'

import { toPosix } from './utils'

function normalizeHandlerOutputPath(value: string) {
  return value.replaceAll('[', '_').replaceAll(']', '_')
}

function getHandlerEntryName(file: string, root: string) {
  const relFromRoot = toPosix(relative(root, file))
  if (relFromRoot === '..' || relFromRoot.startsWith('../') || isAbsolute(relFromRoot)) {
    // Keep outside sources within the handler output, independent of scan order.
    const identity = createHash('sha256').update(relFromRoot).digest('hex')
    return `_external/${identity}`
  }
  const ext = extname(relFromRoot)
  return normalizeHandlerOutputPath(relFromRoot.slice(0, relFromRoot.length - ext.length))
}

/**
 * Options for building a manifest response from a handler.
 *
 * @example
 * import type { BuildResponseOptions } from '@mokup/cli'
 *
 * const options: BuildResponseOptions = {
 *   file: 'mock/ping.get.ts',
 *   handlers: true,
 *   handlerSources: new Set(),
 *   handlerModuleMap: new Map(),
 *   handlersDir: '.mokup/mokup-handlers',
 *   root: process.cwd(),
 *   ruleIndex: 0,
 * }
 */
export interface BuildResponseOptions {
  /** Handler file path. */
  file: string
  /**
   * Whether to emit handler bundles.
   *
   * @default true
   */
  handlers: boolean
  /** Mutable set of handler source files. */
  handlerSources: Set<string>
  /** Map of source file to handler module path. */
  handlerModuleMap: Map<string, string>
  /** Output directory for handler bundles. */
  handlersDir: string
  /** Root directory used for relative paths. */
  root: string
  /** Rule index within the file. */
  ruleIndex: number
}

/**
 * Resolve the handler module path relative to the handlers directory.
 *
 * @param file - Source handler file.
 * @param handlersDir - Handler output directory.
 * @param root - Project root.
 * @returns Relative module path for import.
 *
 * @example
 * import { getHandlerModulePath } from '@mokup/cli'
 *
 * const path = getHandlerModulePath('mock/ping.get.ts', '.mokup/mokup-handlers', process.cwd())
 */
export function getHandlerModulePath(file: string, handlersDir: string, root: string) {
  const outputPath = join(handlersDir, `${getHandlerEntryName(file, root)}.mjs`)
  const relFromOutDir = relative(dirname(handlersDir), outputPath)
  const normalized = toPosix(relFromOutDir)
  return normalized.startsWith('.') ? normalized : `./${normalized}`
}

/**
 * Write the handler module map index files.
 *
 * @param handlerModuleMap - Map of source file to module path.
 * @param handlersDir - Handler output directory.
 * @param outDir - Build output directory.
 *
 * @example
 * import { writeHandlerIndex } from '@mokup/cli'
 *
 * await writeHandlerIndex(new Map(), '.mokup/mokup-handlers', '.mokup')
 */
export async function writeHandlerIndex(
  handlerModuleMap: Map<string, string>,
  handlersDir: string,
  outDir: string,
) {
  const modulePaths = Array.from(new Set(handlerModuleMap.values()))
  if (modulePaths.length === 0) {
    return
  }
  const imports: string[] = []
  const entries: Array<{ key: string, name: string }> = []

  modulePaths.forEach((modulePath, index) => {
    const absolutePath = resolve(outDir, modulePath)
    const relImport = toPosix(relative(handlersDir, absolutePath))
    const importPath = relImport.startsWith('.') ? relImport : `./${relImport}`
    const name = `module${index}`
    imports.push(`import * as ${name} from ${JSON.stringify(importPath)}`)
    entries.push({ key: modulePath, name })
  })

  const lines = [
    ...imports,
    '',
    'export const mokupModuleMap = {',
    ...entries.map(entry => `  ${JSON.stringify(entry.key)}: ${entry.name},`),
    '}',
    '',
  ]

  await fs.writeFile(join(handlersDir, 'index.mjs'), lines.join('\n'), 'utf8')
  const dts = [
    'export type ModuleMap = Record<string, Record<string, unknown>>',
    'export declare const mokupModuleMap: ModuleMap',
    '',
  ]
  await fs.writeFile(join(handlersDir, 'index.d.ts'), dts.join('\n'), 'utf8')
  await fs.writeFile(join(handlersDir, 'index.d.mts'), dts.join('\n'), 'utf8')
}

/**
 * Build a manifest response entry from a handler value.
 *
 * @param handler - Handler value or function.
 * @param options - Build options.
 * @returns Manifest response or null when handlers are disabled.
 *
 * @example
 * import { buildResponse } from '@mokup/cli'
 *
 * const response = buildResponse({ ok: true }, {
 *   file: 'mock/ping.get.ts',
 *   handlers: true,
 *   handlerSources: new Set(),
 *   handlerModuleMap: new Map(),
 *   handlersDir: '.mokup/mokup-handlers',
 *   root: process.cwd(),
 *   ruleIndex: 0,
 * })
 */
export function buildResponse(
  handler: unknown,
  options: BuildResponseOptions,
): ManifestResponse | null {
  if (typeof handler === 'function') {
    if (!options.handlers) {
      return null
    }
    const moduleRel = getHandlerModulePath(
      options.file,
      options.handlersDir,
      options.root,
    )
    options.handlerSources.add(options.file)
    options.handlerModuleMap.set(options.file, moduleRel)
    return {
      type: 'module',
      module: moduleRel,
      ruleIndex: options.ruleIndex,
    }
  }
  if (typeof handler === 'string') {
    return {
      type: 'text',
      body: handler,
    }
  }
  if (handler instanceof Uint8Array || handler instanceof ArrayBuffer) {
    return {
      type: 'binary',
      body: Buffer.from(handler as Uint8Array).toString('base64'),
      encoding: 'base64',
    }
  }
  if (Buffer.isBuffer(handler)) {
    return {
      type: 'binary',
      body: handler.toString('base64'),
      encoding: 'base64',
    }
  }
  return {
    type: 'json',
    body: handler,
  }
}

/**
 * Bundle handler modules into the handlers directory.
 *
 * @param files - Source files to bundle.
 * @param root - Project root.
 * @param handlersDir - Output directory.
 *
 * @example
 * import { bundleHandlers } from '@mokup/cli'
 *
 * await bundleHandlers(['mock/ping.get.ts'], process.cwd(), '.mokup/mokup-handlers')
 */
export async function bundleHandlers(files: string[], root: string, handlersDir: string) {
  const entryPoints = new Map<string, string>()
  for (const file of files) {
    const name = getHandlerEntryName(file, root)
    const source = resolve(file)
    const previous = entryPoints.get(name)
    if (previous && relative(previous, source) !== '') {
      throw new Error(`Handler output path collision for "${name}.mjs": "${previous}" and "${source}".`)
    }
    entryPoints.set(name, source)
  }
  await rolldown({
    entryPoints: Object.fromEntries(entryPoints),
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    outdir: handlersDir,
    entryNames: '[name]',
    outExtension: { '.js': '.mjs' },
    logLevel: 'silent',
  })
  await fs.writeFile(
    join(handlersDir, 'package.json'),
    `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
    'utf8',
  )
}
