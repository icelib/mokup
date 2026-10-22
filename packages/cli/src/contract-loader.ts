import { readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

type JsonObject = Record<string, unknown>

export interface ContractLoadOptions {
  /** Allow `http:` and `https:` external references. Local files are always allowed. */
  allowNetwork?: boolean
}

interface LoadedDocument {
  value: unknown
  filename: string
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

function pointer(root: unknown, fragment: string): unknown {
  if (fragment === '') {
    return root
  }
  if (!fragment.startsWith('#/')) {
    throw new Error(`Only JSON Pointer fragments are supported: ${fragment}`)
  }
  return fragment.slice(2).split('/').reduce<unknown>((value, segment) => {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~')
    return object(value)?.[key]
  }, root)
}

function parseContract(text: string, filename: string): unknown {
  const extension = extname(filename).toLowerCase()
  if (extension === '.yaml' || extension === '.yml') {
    return parseYaml(text)
  }
  try {
    return JSON.parse(text)
  }
  catch (jsonError) {
    try {
      return parseYaml(text)
    }
    catch {
      throw jsonError
    }
  }
}

function isUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value)
}

function resolveReference(ref: string, current: string): { target: string, fragment: string } {
  const hash = ref.indexOf('#')
  const source = hash === -1 ? ref : ref.slice(0, hash)
  const fragment = hash === -1 ? '' : `#${ref.slice(hash + 1)}`
  if (isUrl(source)) {
    return { target: source, fragment }
  }
  if (source === '') {
    return { target: current, fragment }
  }
  if (isUrl(current)) {
    return { target: new URL(source, current).href, fragment }
  }
  return { target: resolve(dirname(current), source), fragment }
}

async function loadDocument(target: string, options: ContractLoadOptions): Promise<LoadedDocument> {
  if (isUrl(target)) {
    if (!options.allowNetwork) {
      throw new Error(`Network external reference is disabled: ${target}. Pass --allow-network to enable it.`)
    }
    const response = await fetch(target)
    if (!response.ok) {
      throw new Error(`Unable to load external contract ${target}: ${response.status} ${response.statusText}`)
    }
    return { value: parseContract(await response.text(), target), filename: target }
  }
  const filename = isAbsolute(target) ? target : resolve(target)
  return { value: parseContract(await readFile(filename, 'utf8'), filename), filename }
}

/**
 * Parse JSON/YAML and resolve external OpenAPI `$ref` files into one immutable
 * document. The runtime contract compiler remains synchronous and receives the
 * fully dereferenced object, so browser and Worker bundles do not need a file
 * system or YAML parser.
 */
export async function loadContractDocument(filename: string, options: ContractLoadOptions = {}): Promise<unknown> {
  const cache = new Map<string, unknown>()
  const roots = new Map<string, unknown>()
  const active = new Set<string>()
  let visit: (value: unknown, current: string) => Promise<unknown>

  async function visitDocument(target: string): Promise<unknown> {
    const cached = cache.get(target)
    if (cached !== undefined) {
      return cached
    }
    if (active.has(target)) {
      throw new Error(`Circular external contract reference: ${target}`)
    }
    active.add(target)
    try {
      const loaded = await loadDocument(target, options)
      roots.set(target, loaded.value)
      const resolved = await visit(loaded.value, loaded.filename)
      cache.set(target, resolved)
      return resolved
    }
    finally {
      active.delete(target)
    }
  }

  visit = async function visit(value: unknown, current: string): Promise<unknown> {
    if (Array.isArray(value)) {
      return Promise.all(value.map(item => visit(item, current)))
    }
    const item = object(value)
    if (!item) {
      return value
    }
    if (typeof item['$ref'] === 'string') {
      const { target, fragment } = resolveReference(item['$ref'], current)
      const document = target === current && roots.has(target) ? roots.get(target) : await visitDocument(target)
      const selected = pointer(document, fragment)
      if (selected === undefined) {
        throw new Error(`External contract reference was not found: ${item['$ref']}`)
      }
      const resolved = await visit(selected, target)
      const siblings = Object.fromEntries(Object.entries(item).filter(([key]) => key !== '$ref'))
      return Object.keys(siblings).length ? { ...object(resolved), ...(await visit(siblings, current) as JsonObject) } : resolved
    }
    return Object.fromEntries(await Promise.all(Object.entries(item).map(async ([key, child]) => [key, await visit(child, current)] as const)))
  }

  return visitDocument(isUrl(filename) ? filename : resolve(filename))
}
