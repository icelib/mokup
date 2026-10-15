# Vite Build Output

Generate deployable artifacts with the CLI:

::: code-group

```bash [pnpm]
pnpm exec mokup build --dir mock --out .mokup
```

```bash [npm]
npm exec mokup build --dir mock --out .mokup
```

```bash [yarn]
yarn mokup build --dir mock --out .mokup
```

```bash [bun]
bunx mokup build --dir mock --out .mokup
```

:::

Output structure:

```
.mokup/
  mokup.manifest.json
  mokup.manifest.mjs
  mokup.manifest.d.mts
  mokup.bundle.mjs
  mokup.bundle.d.ts
  mokup.bundle.d.mts
  mokup-handlers/ (optional)
```

`mokup.bundle.mjs` is the easiest entry for Workers or custom runtimes.

## Service Worker build

When you set `mode: 'sw'` in the Vite plugin, the service worker script is emitted during `vite build` (default `/mokup-sw.js`). The plugin also injects a registration snippet unless `sw.register` is `false`.

`sw.path` may include the full Vite `base` prefix. With `base: '/workspace/'`, both `/mokup-sw.js` and `/workspace/mokup-sw.js` produce `dist/mokup-sw.js` and register `/workspace/mokup-sw.js`; the build does not add a duplicate `workspace` directory.

```ts
import mokup from 'mokup/vite'

export default {
  plugins: [
    mokup({
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

This is ideal for static hosting because mock requests are handled in the browser. If you also ship the playground, set `playground: { build: true }` so `vite build` emits the Playground assets and `/__mokup/routes`. As an alternative, you can generate `/__mokup/routes` with `mokup build` or a small script and publish it alongside the site.

A Playground build must target a separate directory within `outDir`. Paths that resolve to `outDir` itself, leave it, or traverse an existing symbolic link beneath it are rejected before output is replaced.

Vite resolves a relative `build.outDir` from the project `root`. The Playground follows the same rule, and a `playground.path` that already includes `base` does not add that prefix again on disk. For example, `base: '/workspace/'` with `playground.path: '/workspace/inspect/mocks'` writes to `<outDir>/inspect/mocks` and is served at `/workspace/inspect/mocks/`.

With `playground.build: true`, `vite preview` serves the built Playground HTML, assets, and route list. Changes to mock source files appear there after the next build. This mount takes precedence over server mock routes; requests elsewhere retain their usual mock behavior. With `playground.build: false`, the preview Playground continues to use the current mock source files.

The dynamic Playground can also register a Service Worker when opened directly in `vite preview`. Registration uses the existing worker from `vite build`, so deleting source routes does not disable a worker that was already built, and source changes require a rebuild to update its responses. If the worker artifact is missing, the Playground does not try to register it. The current preview configuration still controls `sw.register` and `sw.unregister`; explicit unregister works even after the worker file has been removed.

Notes:

- `sw.basePath` controls which requests the SW intercepts. If omitted, it inherits the entry `prefix`.
