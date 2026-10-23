import type { DefaultTheme } from 'vitepress'
import { docsTargets, resolveChannel } from '../../../../scripts/docs-deployment/identity.mjs'

export interface DocsThemeConfig extends DefaultTheme.Config {
  docsPreview: boolean
  stableUrl: string
}

export function getDocsDeployment(channel?: string) {
  const selected = resolveChannel(channel) as keyof typeof docsTargets
  return {
    channel: selected,
    preview: selected === 'preview',
    origin: docsTargets[selected].url,
    stableUrl: docsTargets.stable.url,
  }
}
