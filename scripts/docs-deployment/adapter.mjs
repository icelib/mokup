import { writeFile } from 'node:fs/promises'
import { assertDocumentationArtifacts } from './artifacts.mjs'
import { activeMatchingVersion, cloudflareClient } from './cloudflare.mjs'
import { assertDeploymentContext, buildIdentity, docsTargets, resolveChannel } from './identity.mjs'

/** Write a successful result only after the intended version receives all traffic. */
export async function deployDocumentation({ channel: selectedChannel, env, directory, upload, request }) {
  const channel = resolveChannel(selectedChannel)
  assertDeploymentContext(env, channel)
  const identity = buildIdentity(env)
  await assertDocumentationArtifacts(directory, identity)
  const target = docsTargets[channel]
  const client = cloudflareClient(env, request)
  let versionId = await activeMatchingVersion(client, target.worker, identity)
  if (!versionId) {
    versionId = await upload(target, identity)
    const active = await activeMatchingVersion(client, target.worker, identity)
    if (active !== versionId) {
      throw new Error('The uploaded documentation version is not confirmed active; retry this same deployment.')
    }
  }
  const result = { versionId, url: target.url }
  await writeFile(env.REPO_DOCS_RESULT_FILE, `${JSON.stringify(result)}\n`)
  return result
}
