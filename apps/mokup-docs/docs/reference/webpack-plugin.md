# Webpack Plugin

Use `mokup/webpack` to integrate Mokup with webpack-dev-server and webpack builds.

## Install

::: code-group

```bash [pnpm]
pnpm add -D mokup
```

```bash [npm]
npm install -D mokup
```

```bash [yarn]
yarn add -D mokup
```

```bash [bun]
bun add -d mokup
```

:::

## Usage

Use cases:

- Add Mokup mocks to webpack-dev-server without changing app code.
- Emit SW assets during webpack builds for browser-level mocking.

Recommended (with wrapper):

```ts
import { mokupWebpack } from 'mokup/webpack'

const withMokup = mokupWebpack({
  entries: {
    dir: 'mock',
    prefix: '/api',
  },
})

export default withMokup({})
```

Direct plugin (short name):

```ts
import { createWebpackPlugin } from 'mokup/webpack'

export default {
  plugins: [
    createWebpackPlugin({
      entries: {
        dir: 'mock',
        prefix: '/api',
      },
    }),
  ],
  devServer: {},
}
```

## Service Worker mode

Use cases:

- Run mock handlers in a browser Service Worker during webpack builds.
- Share the same mock directory between dev-server and SW.

Demo:

```ts
import { createWebpackPlugin } from 'mokup/webpack'

export default {
  plugins: [
    createWebpackPlugin({
      entries: {
        dir: 'mock',
        prefix: '/api',
        mode: 'sw',
        sw: {
          path: '/mokup-sw.js',
          scope: '/',
        },
      },
    }),
  ],
}
```

## Options

Options match the Vite plugin: top-level `entries` + `playground`, plus entry options for each item. See [Vite Plugin](./vite-plugin) for the full list.

## Strict diagnostics

`errorOn` is also available in webpack mode. Use it to fail startup or build when
selected diagnostics are detected instead of only printing warnings.

Example:

```ts
import { createWebpackPlugin } from 'mokup/webpack'

export default {
  plugins: [
    createWebpackPlugin({
      errorOn: ['invalid-route', 'sw-conflict'],
      entries: {
        dir: 'mock',
        prefix: '/api',
        mode: 'sw',
      },
    }),
  ],
}
```

Supported categories are the same as Vite: `invalid-route`, `unsupported-fields`,
`missing-handler`, `duplicate-route`, and `sw-conflict`.

## Notes

- Published packages are ESM-only. Prefer `webpack.config.ts` or `webpack.config.mjs`.
- Dev server support uses `devServer.setupMiddlewares`; ensure `webpack-dev-server` is enabled.
- Closing Webpack watching cancels queued mock refreshes and discards unfinished results. Starting a new watch session restores mock watching. Route and SW bundle updates are published together after a successful refresh; an unsuccessful refresh keeps the previous successful result.
- Files edited while the watcher starts are refreshed once filesystem watching is ready.
- `mokupWebpack(...)` auto-creates a `devServer` object, so you can omit it unless you need custom dev-server settings.
- The SW lifecycle script is emitted under your assets directory (default `assets/mokup-sw-lifecycle.js`). With `html-webpack-plugin` it is auto-injected; otherwise include it manually.
