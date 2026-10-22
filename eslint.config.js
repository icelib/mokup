import { defineEslintConfig } from 'repoctl/tooling'

export default await defineEslintConfig(
  {
    vue: true,
    ignores: ['**/fixtures/**', '**/.wrangler/**', '**/.tmp/**', '**/test-results/**', '**/test-results-conformance/**', '**/playwright-report/**'],
    rules: {
      'dot-notation': 'off',
    },
  },
)
