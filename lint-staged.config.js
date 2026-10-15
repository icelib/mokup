import { defineLintStagedConfig } from 'repoctl/tooling'

export default await defineLintStagedConfig({
  options: {
    config: {
      '*.{js,jsx,mjs,ts,tsx,mts,vue}': ['eslint --fix --no-warn-ignored'],
      '*.{json,md,mdx,css,html,yml,yaml,scss}': ['eslint --fix --no-warn-ignored'],
    },
  },
})
