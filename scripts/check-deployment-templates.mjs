import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const files = [
  'examples/deploy/node/server.mjs',
  'examples/deploy/deno/main.ts',
  'examples/deploy/bun/server.ts',
  'examples/deploy/cloudflare/src/index.ts',
  'examples/deploy/vercel/api/[[...path]].ts',
  'examples/deploy/netlify/edge-functions/mokup.ts',
]

for (const relative of files) {
  const source = await readFile(resolve(root, relative), 'utf8')
  if (!source.includes('createFetchHandler') && !source.includes('createMokupWorker')) {
    throw new Error(`Deployment template does not use a Mokup fetch adapter: ${relative}`)
  }
  if (!source.includes('/api/health')) {
    throw new Error(`Deployment template is missing the smoke route: ${relative}`)
  }
}

console.log(`Checked ${files.length} Mokup deployment templates.`)
