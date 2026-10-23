import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
// eslint-disable-next-line e18e/ban-dependencies -- Reuse the workspace's cross-platform pnpm process runner.
import { execa } from 'execa'
import { assertDocumentationArtifacts } from './artifacts.mjs'
import { buildIdentity } from './identity.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const identity = buildIdentity(process.env, sourceSha)
const env = { ...process.env, REPO_DOCS_CHANNEL: identity.channel }
await execa('pnpm', ['run', 'build:packages'], { cwd: root, env, stdio: 'inherit' })
// Channel and deployment identity belong to this build, never to a Turbo cache entry.
await execa('pnpm', ['--filter', 'mokup-docs', 'run', 'build'], { cwd: root, env, stdio: 'inherit' })
const output = path.join(root, 'apps/mokup-docs/docs/.vitepress/dist')
await writeFile(path.join(output, 'docs-build.json'), `${JSON.stringify(identity)}\n`)
await assertDocumentationArtifacts(output, identity)
