import { icebreaker } from '@icebreakers/eslint-config'

export default icebreaker(
  {
    vue: true,
    ignores: ['**/fixtures/**', '**/.wrangler/**', '**/.tmp/**'],
    rules: {
      'dot-notation': 'off',
    },
  },
)
