<p align="center">
  <img src="docs/assets/mokup-logo.svg" width="180" alt="Mokup logo">
</p>
<h1 align="center">mokup</h1>
<p align="center">File-based mock toolkit for Vite, CLI builds, and runtime usage.</p>
<p align="center">
  <a href="https://mokup.icebreaker.top/">Website</a> ·
  <a href="https://mokup.icebreaker.top/__mokup">Playground</a> ·
  <a href="https://github.com/sonofmagic/mokup">GitHub</a>
</p>

## Why mokup

- File-based routing via filename suffixes like `users.get.json`.
- JSON/JSONC and TS/JS handlers powered by Hono Context.
- Works in Vite dev, CLI builds (workers), and runtime adapters.
- Built-in headers, status, delays, and middleware hooks.

## Requirements

- Node.js `>=22.12.0`

## Upgrade Notes

- Published packages are ESM-only. CommonJS `require()` is no longer supported.
- Internal build packages now use `tsdown` on top of Rolldown.
- Shared build helpers are exposed from `@mokup/shared/rolldown`.

## Quick start

Create `mock/users.get.json`:

```json
{ "ok": true }
```

Create `mock/login.post.ts`:

```ts
export default async (c) => {
  const body = await c.req.json().catch(() => ({}))
  return { ok: true, user: body }
}
```

Tip: you can use `defineHandler` for better IntelliSense:

```ts
import { defineHandler } from 'mokup'

export default defineHandler(async (c) => {
  const body = await c.req.json().catch(() => ({}))
  return { ok: true, user: body }
})
```

Follow the docs at https://mokup.icebreaker.top/ for Vite and CLI setup.
Upgrade details: [docs/guide/migration-v1.md](docs/guide/migration-v1.md)

## Contributing

Repository development requires Node.js `>=24.15.0` and the pnpm version pinned in `package.json`.

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

CI uses Node.js 24 LTS, and shared repository tooling uses repoctl. Published packages retain the runtime requirement listed above. Create release intents with `pnpm change` and preview them with `pnpm exec repo release plan`.

### Development Checks

- `pnpm run validate:fast`
- `pnpm run guard:migration`
- `pnpm run typecheck:fast`
- `pnpm run lint:lines:guard`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:e2e:serial`

## Contributors

Thanks to [all contributors](https://github.com/sonofmagic/mokup/graphs/contributors)!

## Authors

ice breaker <hi@sonofmagic.top>

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
