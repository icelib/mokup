import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPackageConfig } from '../../scripts/tsdown-config.ts'

export default createPackageConfig({
  entries: [
    'src/network/mockServiceWorker',
    'src/ws',
    'src/testing',
    'src/diagnostics',
    'src/devframe',
    'src/mcp',
    'src/mcp-stdio',
    'src/plugin',
    'src/http',
    'src/node',
    'src/browser',
    'src/scenario',
    'src/recording',
    'src/contract',
    'src/graphql',
    'src/sse',

    'src/cli-bin',
    'src/cli',
    'src/bundle',
    'src/index',
    'src/runtime',
    'src/server',
    'src/server/fetch',
    'src/server/node',
    'src/server/worker',
    'src/vite',
    'src/webpack',
    'src/sw',
  ],
  copy: [
    {
      from: 'src/types',
      to: 'dist/types',
    },
  ],
  onBuildDone: async ({ distDir }) => {
    const updates = [
      {
        file: resolve(distDir, 'index.d.ts'),
        ref: '/// <reference path="./types/virtual.d.ts" />',
      },
      {
        file: resolve(distDir, 'vite.d.ts'),
        ref: '/// <reference path="./types/virtual.d.ts" />',
      },
      {
        file: resolve(distDir, 'server/worker.d.ts'),
        ref: '/// <reference path="../types/virtual.d.ts" />',
      },
    ]

    await Promise.all(updates.map(async ({ file, ref }) => {
      try {
        const contents = await readFile(file, 'utf8')
        if (!contents.includes(ref)) {
          await writeFile(file, `${ref}\n\n${contents}`, 'utf8')
        }
      }
      catch {
        // Ignore missing outputs during partial watch updates.
      }
    }))
  },
})
