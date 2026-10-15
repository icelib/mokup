import { Buffer } from 'node:buffer'
import { basename, extname, relative, resolve } from 'node:path'
import process from 'node:process'
import { build as rolldownBuild } from 'rolldown'

export interface StdinOptions {
  contents: string
  loader?: 'js' | 'jsx' | 'ts' | 'tsx'
  resolveDir?: string
  sourcefile?: string
}

export interface BuildOptions {
  absWorkingDir?: string
  bundle?: boolean
  entryNames?: string
  entryPoints?: string[] | Record<string, string>
  format?: 'cjs' | 'esm' | 'iife'
  logLevel?: 'debug' | 'error' | 'info' | 'silent' | 'warn'
  outbase?: string
  outdir?: string
  outExtension?: Record<string, string>
  platform?: 'browser' | 'neutral' | 'node'
  stdin?: StdinOptions
  target?: string | string[]
  write?: boolean
}

export interface OutputFile {
  contents: Uint8Array
  path: string
  text: string
}

export interface BuildResult {
  outputFiles: OutputFile[]
}

const defaultEntryName = '[name]'
const defaultJsExtension = '.js'
const virtualEntryBaseName = '__mokup_stdin_entry__'

interface RolldownOutputItem {
  code?: string
  fileName?: string
  source?: string | Uint8Array
  type?: 'asset' | 'chunk'
}

function toPosixPath(value: string) {
  return value.replaceAll('\\', '/')
}

function stripExtension(value: string) {
  const extension = extname(value)
  return extension ? value.slice(0, -extension.length) : value
}

function resolveEntryNamePattern(options: BuildOptions) {
  const pattern = (options.entryNames ?? defaultEntryName).replaceAll('[dir]/', '')
  const jsExtension = options.outExtension?.['.js'] ?? defaultJsExtension
  return `${pattern}${jsExtension}`
}

function normalizeInput(entryPoints: string[] | Record<string, string>, options: BuildOptions) {
  if (!Array.isArray(entryPoints)) {
    return entryPoints
  }
  const baseDir = options.outbase ?? options.absWorkingDir ?? process.cwd()
  return Object.fromEntries(entryPoints.map((entryPoint) => {
    const relPath = relative(baseDir, entryPoint)
    const fallbackName = stripExtension(basename(entryPoint))
    const normalizedName = relPath && !relPath.startsWith('..')
      ? stripExtension(toPosixPath(relPath))
      : fallbackName
    return [normalizedName, entryPoint]
  }))
}

function normalizeStdinEntry(options: BuildOptions) {
  const stdin = options.stdin
  if (!stdin) {
    return null
  }
  const loader = stdin.loader ?? 'js'
  const resolveDir = stdin.resolveDir ?? options.absWorkingDir ?? process.cwd()
  const sourceFile = stdin.sourcefile ?? `${virtualEntryBaseName}.${loader}`
  const fileName = extname(sourceFile) ? sourceFile : `${sourceFile}.${loader}`
  const virtualId = resolve(resolveDir, fileName)
  const plugin = {
    name: 'mokup-stdin-entry',
    load(id: string) {
      if (id === virtualId) {
        return stdin.contents
      }
      return null
    },
    resolveId(id: string) {
      if (id === virtualId) {
        return virtualId
      }
      return null
    },
  }
  return { plugin, virtualId }
}

function toOutputFiles(output: RolldownOutputItem[], outdir?: string): OutputFile[] {
  return output
    .filter((item): item is RolldownOutputItem & { fileName: string } => Boolean(item.fileName))
    .map((item) => {
      const contents = item.type === 'chunk'
        ? Buffer.from(item.code ?? '')
        : typeof item.source === 'string'
          ? Buffer.from(item.source)
          : Buffer.from(item.source ?? [])
      return {
        contents,
        path: outdir ? resolve(outdir, item.fileName) : item.fileName,
        text: contents.toString('utf8'),
      }
    })
}

/**
 * Rolldown-backed compatibility wrapper for the subset of `build()`
 * API used inside this repository.
 */
export async function build(options: BuildOptions): Promise<BuildResult> {
  const stdinEntry = normalizeStdinEntry(options)
  const input = stdinEntry
    ? stdinEntry.virtualId
    : normalizeInput(options.entryPoints ?? [], options)

  const result = await rolldownBuild({
    cwd: options.absWorkingDir,
    input,
    logLevel: options.logLevel,
    platform: options.platform,
    plugins: stdinEntry ? [stdinEntry.plugin] : [],
    write: options.write,
    output: {
      dir: options.outdir,
      entryFileNames: resolveEntryNamePattern(options),
      format: options.format,
    },
  } as never) as { output?: RolldownOutputItem[] } | undefined

  return {
    outputFiles: toOutputFiles(result?.output ?? [], options.outdir),
  }
}
