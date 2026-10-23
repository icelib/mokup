import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
// eslint-disable-next-line e18e/ban-dependencies -- Resolve pnpm.cmd consistently and propagate deployment failures.
import { execa } from 'execa'
import { deployDocumentation } from './adapter.mjs'
import { readDeploymentVersion } from './cloudflare.mjs'
import { deploymentMessage } from './identity.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const website = path.join(root, 'apps/mokup-docs')

async function upload(target, identity) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'mokup-site-deploy-'))
  const outputFile = path.join(temporary, 'wrangler.jsonl')
  try {
    await execa('pnpm', ['exec', 'wrangler', 'deploy', '--env', target.environment, '--message', deploymentMessage(identity)], {
      cwd: website,
      env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: outputFile },
      stdio: 'inherit',
    })
    return readDeploymentVersion(await readFile(outputFile, 'utf8'), target.worker, target.environment)
  }
  finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

const result = await deployDocumentation({
  channel: process.argv[2],
  env: process.env,
  directory: path.join(website, 'docs/.vitepress/dist'),
  upload,
})
console.log(JSON.stringify(result))
