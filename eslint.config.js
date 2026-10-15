import { defineEslintConfig } from 'repoctl/tooling'

export default await defineEslintConfig(
  {
    vue: true,
    ignores: ['**/fixtures/**', '**/.wrangler/**', '**/.tmp/**'],
    rules: {
      'dot-notation': 'off',
    },
  },
)
