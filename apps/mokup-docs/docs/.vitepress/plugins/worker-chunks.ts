import type { Plugin } from 'vite'

/** Keep the page and service worker runtime boundaries intact in VitePress builds. */
export function isolateWorkerChunks(): Plugin {
  return {
    name: 'mokup-docs-worker-chunks',
    apply: 'build',
    enforce: 'post',
    outputOptions(options) {
      // VitePress groups every \0vite helper into its DOM-dependent framework chunk.
      // Mokup's worker also uses the dynamic-import helper, so let the bundler split
      // shared modules by their actual importers instead of these manual groups.
      if (options.codeSplitting && typeof options.codeSplitting === 'object') {
        return {
          ...options,
          codeSplitting: { ...options.codeSplitting, groups: [] },
        }
      }
      return options
    },
    generateBundle(_options, bundle) {
      const pending = ['mokup-sw.js']
      const visited = new Set<string>()
      while (pending.length > 0) {
        const filename = pending.pop()!
        if (visited.has(filename)) {
          continue
        }
        visited.add(filename)
        const chunk = bundle[filename]
        if (!chunk || chunk.type !== 'chunk') {
          continue
        }
        for (const id of chunk.moduleIds) {
          if (id.includes('/vitepress/dist/client/') || id.includes('/@vue/runtime-dom/')) {
            this.error(`Documentation service worker depends on page runtime ${id} through ${filename}`)
          }
        }
        pending.push(...chunk.imports, ...chunk.dynamicImports)
      }
    },
  }
}
