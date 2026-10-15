# Hot Reload & Debug

Mokup watches mock directories during Vite dev and refreshes routes automatically.

## Enable/disable watch

```ts
import mokup from 'mokup/vite'

export default {
  plugins: [
    mokup({
      entries: {
        dir: 'mock',
        watch: true,
      },
    }),
  ],
}
```

Set `watch: false` to disable file watching.

## Native module refresh

Native loading, such as the standalone [Fetch server](../reference/server.md#fetch-server-node),
refreshes ESM `.js` and `.mjs` entries, CommonJS `.cjs` entries, and TypeScript `.ts` entries without
depending on the system clock advancing. Consecutive refreshes in the same
millisecond or after a clock adjustment reload the entry, including when its
path is a symbolic link.

TypeScript follows the nearest `package.json`: `"type": "module"` uses ESM,
while CommonJS or missing `type` uses CommonJS. Both support TypeScript default
exports. ESM keeps top-level await.
The native loader uses a process-wide tsconfig, as before; use separate processes
when projects need independent TypeScript alias configurations.

This refresh applies to the mock or configuration entry itself. Helpers and
shared dependencies that it has already imported or required remain cached;
changing them may require restarting the native server process, even after
refreshing the entry. Vite dev uses Vite's module graph invalidation for modules
it loads, so its dependency refresh behavior follows that graph.

## Vite refresh

During Vite dev, when every entry uses SW mode with automatic registration and `sw.fallback: false`,
both runtime modes update mock responses through the SW updater without reloading the
page on every edit. An empty-to-nonempty transition can still reload the page to
bootstrap registration. Worker runtime entries with server fallback, mixed
server routes, or manual SW registration retain their full-page refresh behavior.

A refresh publishes its route table, Playground metadata, and Service Worker
route data together, after scanning and app construction succeed. If `errorOn`
rejects a diagnostic or app construction fails, the previous successful route
snapshot stays active. Diagnostics still describe the latest scan; fixing the
mock or configuration allows the next successful refresh to take effect.

With watching enabled, Node mock routes update in both Vite dev and preview even
when the configured mock directory is empty at startup. Adding the first valid
route takes effect after the watcher refreshes, without restarting the server.
Deleting all routes lets requests pass through to the application's remaining
middleware; adding a route again restores mocking.

Vite preview serves the Service Worker emitted by the build, including its
bundled handlers and middleware. Rebuild to include SW mock changes in preview;
editing source files alone does not replace that built snapshot. Automatic and
manual SW registration follow the build's `sw.register` setting.

During Vite dev, with HMR and automatic Service Worker registration enabled,
adding the first SW route to an empty route table reloads the page to load the
registration script. Removing all SW routes updates the registered worker to an
empty route table, so requests pass through to the network. Setting
`sw.register: false` continues to disable automatic registration.

During Vite dev, successful mock and configuration refreshes reuse idle entries
in Vite's module graph. Overlapping loads use separate request identities, so
their count follows each input's peak concurrency rather than the number of
scans. Different aliases and query strings are distinct inputs; repairing a
resolution failure can also require a new identity. Imported helpers refresh
through Vite's watcher and dependency graph; dependencies externalized to Node
keep Node's cache behavior.

## Debug tips

- Playground refreshes on route changes (`mokup:routes-changed`).
- In Service Worker mode, edits made while a worker is installing are queued and
  applied after installation finishes. You do not need to reload the page to pick
  up those edits.
- Ensure file names include method suffixes.
- Handler logs appear in Vite dev output.

## Debug mock handlers and middleware

Mock handlers and directory middleware run on the Node side of Vite, so use a
Node debugger rather than browser DevTools.

### VSCode (recommended)

1. Open the Command Palette and run **Debug: Create JavaScript Debug Terminal**.
2. In that terminal, start your dev command (for example `pnpm dev --filter <app>`).
3. Set breakpoints in `mock/**/*.ts` or `mock/**/index.config.ts`.

If you prefer a `launch.json`, use a Node launch config with `pnpm` and enable
source maps and child process attach:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Vite Dev (mock debug)",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["dev", "--filter", "<app>"],
  "cwd": "${workspaceFolder}",
  "env": {
    "NODE_OPTIONS": "--enable-source-maps --inspect"
  },
  "autoAttachChildProcesses": true
}
```

### Terminal + Node Inspector

```bash
NODE_OPTIONS="--inspect-brk --enable-source-maps" pnpm dev --filter <app>
```

Then attach from VSCode ("Attach to Node") or open `chrome://inspect`.

### Quick sanity checks

- Add `debugger;` or `console.log` in the handler to confirm it is being loaded.
- Preview builds may not support Vite dev debugging; use `dev` for breakpoints.
