# Mokup deployment templates

These small templates use the same `createFetchHandler` contract on every
runtime. Replace the inline `handlers` with a generated bundle from
`mokup build` when the project has file routes.

Install the package in the target project first:

```sh
pnpm add mokup
# or: npm install mokup
```

The templates are intentionally dependency-light:

| Runtime            | Entry                             | Start/deploy command                |
| ------------------ | --------------------------------- | ----------------------------------- |
| Node               | `node/server.mjs`                 | `node node/server.mjs`              |
| Deno               | `deno/main.ts`                    | `deno run --allow-net deno/main.ts` |
| Bun                | `bun/server.ts`                   | `bun run bun/server.ts`             |
| Cloudflare Workers | `cloudflare/src/index.ts`         | `wrangler deploy`                   |
| Vercel             | `vercel/api/[[...path]].ts`       | `vercel deploy`                     |
| Netlify Edge       | `netlify/edge-functions/mokup.ts` | `netlify deploy`                    |

Every entry returns `GET /api/health` with the same JSON response. Unmatched
requests return a 404 response, which makes smoke testing independent of a
framework router. The adapters do not import Devframe or any deployment SDK.
