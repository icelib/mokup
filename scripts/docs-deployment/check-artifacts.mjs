import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { assertDocumentationArtifacts } from './artifacts.mjs'

const directory = fileURLToPath(new URL('../../apps/mokup-docs/docs/.vitepress/dist', import.meta.url))
const identity = JSON.parse(await readFile(new URL('../../apps/mokup-docs/docs/.vitepress/dist/docs-build.json', import.meta.url), 'utf8'))
await assertDocumentationArtifacts(directory, identity)
console.log(`Documentation artifacts verified: ${identity.channel} (${identity.sourceSha})`)
