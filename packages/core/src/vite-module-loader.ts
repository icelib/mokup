import type { ModuleGraph, ModuleNode, ViteDevServer } from 'vite'
import { randomUUID } from 'node:crypto'

type ModuleLoad = ReturnType<ViteDevServer['ssrLoadModule']>

interface RequestSlot {
  token: string
  busy: boolean
}

// Vite 5 shares pending SSR requests across servers. Each graph and input owns
// its slots, so concurrent loads and restarted servers never reuse an active ID.
const states = new WeakMap<ModuleGraph, Map<string, RequestSlot[]>>()
const querySeparator = /[?#]/

function acquireSlot(graph: ModuleGraph, file: string) {
  let state = states.get(graph)
  if (!state) {
    state = new Map()
    states.set(graph, state)
  }
  let slots = state.get(file)
  if (!slots) {
    slots = []
    state.set(file, slots)
  }
  let slot = slots.find(candidate => !candidate.busy)
  if (!slot) {
    slot = { token: randomUUID(), busy: false }
    slots.push(slot)
  }
  slot.busy = true
  return slot
}

async function resolveEntry(graph: ModuleGraph, requestId: string) {
  // Do not ensure a node here: Vite 5 initializes its SSR optimizer inside
  // ssrLoadModule, and pre-creating a node can cache an unoptimized CommonJS ID.
  const [, id] = await graph.resolveUrl(requestId, true)
  const entry = graph.getModuleById(id)
  return { entry, file: entry?.file ?? id.split(querySeparator)[0] ?? id }
}

function invalidateModules(graph: ModuleGraph, file: string, resolvedFile: string, entry?: ModuleNode) {
  const nodes = new Set<ModuleNode>()
  if (entry) {
    nodes.add(entry)
  }
  const byId = graph.getModuleById(file)
  if (byId) {
    nodes.add(byId)
  }
  for (const filename of new Set([file, resolvedFile])) {
    for (const node of graph.getModulesByFile?.(filename) ?? []) {
      nodes.add(node)
    }
  }
  for (const node of nodes) {
    graph.invalidateModule(node)
  }
}

export async function loadViteModule(server: ViteDevServer, file: string): ModuleLoad {
  const graph = server.moduleGraph
  const slot = acquireSlot(graph, file)
  const requestId = `${file}${file.includes('?') ? '&' : '?'}mokupv=${slot.token}`
  let resolved = false
  try {
    const entry = await resolveEntry(graph, requestId)
    resolved = true
    if (server.moduleGraph !== graph) {
      return await loadViteModule(server, file)
    }
    invalidateModules(graph, file, entry.file, entry.entry)
    return await server.ssrLoadModule(requestId)
  }
  catch (error) {
    if (!resolved) {
      slot.token = randomUUID()
    }
    else {
      // Native SSR resolution may fail after our preflight. Vite retains that
      // rejected URL promise; rotate only if resolution itself is still failing.
      try {
        await resolveEntry(graph, requestId)
      }
      catch {
        slot.token = randomUUID()
      }
    }
    throw error
  }
  finally {
    // Reuse idle IDs instead of accumulating one per scan. The number of IDs
    // for a successful input is bounded by its peak number of overlapping loads.
    slot.busy = false
  }
}
