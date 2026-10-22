import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPackageConfig } from '../../scripts/tsdown-config.ts'

export default createPackageConfig({
  entries: ['src/index', 'src/ws', 'src/diagnostics', 'src/plugin', 'src/mcp', 'src/http', 'src/scenario', 'src/recording', 'src/contract', 'src/graphql', 'src/sse'],
  async onBuildDone({ distDir }) {
    const files = await readdir(distDir, { withFileTypes: true })

    await Promise.all(files.map(async (file) => {
      if (!file.isFile() || !file.name.endsWith('.mjs')) {
        return
      }

      const filePath = resolve(distDir, file.name)
      const source = await readFile(filePath, 'utf8')
      const next = source.replaceAll(
        'await import(resolvedUrl ?? modulePath)',
        'await import(/* @vite-ignore */ resolvedUrl ?? modulePath)',
      )

      if (next !== source) {
        await writeFile(filePath, next, 'utf8')
      }
    }))
  },
})
