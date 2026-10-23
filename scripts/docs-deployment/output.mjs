import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function writeDeploymentFiles(directory, deployment) {
  await writeFile(path.join(directory, 'robots.txt'), deployment.preview
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nSitemap: ${deployment.origin}/sitemap.xml\n`)
  await writeFile(path.join(directory, '_headers'), deployment.preview
    ? '/*\n  X-Robots-Tag: noindex, nofollow\n'
    : '/*\n  X-Robots-Tag: index, follow\n')
  if (deployment.preview) {
    await rm(path.join(directory, 'sitemap.xml'), { force: true })
  }
}
