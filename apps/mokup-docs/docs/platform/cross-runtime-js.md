# Cross-Runtime JavaScript Guide

Write code once, run it in Service Workers, Cloudflare Workers, and Node.js by
keeping your core logic on Web-standard APIs and isolating runtime differences
in thin adapters.

## Goals and boundaries

Your goal is a shared request handler that:

- uses `Request`, `Response`, `URL`, and `Headers`
- avoids direct filesystem access
- treats environment bindings as optional
- keeps runtime-specific glue in one place

What this guide is not: a framework-specific adapter. The examples show the
smallest portable core you can embed in any runtime.

## Runtime differences at a glance

Service Worker:

- no filesystem
- event-driven via `fetch` event
- `caches` is available in browsers

Cloudflare Worker:

- no filesystem
- module or service-worker syntax
- bindings come from `env`

Node.js (>=22.12.0):

- `fetch`/`Request`/`Response` available
- filesystem exists, but avoid for portability
- environment variables via `process.env`

## Compatibility checklist

- Use `globalThis` and Web APIs (`fetch`, `Request`, `Response`, `Headers`, `URL`).
- Avoid `Buffer` and `fs` in shared logic; prefer `ArrayBuffer`/`Uint8Array`.
- Keep JSON/text handling explicit (`response.json()`, `response.text()`).
- Treat `env` as optional and feature-detect missing bindings.
- Do not rely on `window`/`document`/DOM in shared modules.
- Avoid Node-only globals (`__dirname`, `process`), or guard them.
- Keep modules ESM to match Worker runtimes.

## Minimal cross-runtime handler

```ts
export type RuntimeEnv = Record<string, string | undefined>

export async function handleRequest(
  request: Request,
  env?: RuntimeEnv,
): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/health') {
    return new Response('ok')
  }
  const apiBase = env?.API_BASE ?? 'https://example.com'
  const upstream = new URL(url.pathname, apiBase)
  const response = await fetch(upstream.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' ? undefined : request.body,
  })
  return response
}
```

## Service Worker adapter

```ts
import { handleRequest } from './shared'

globalThis.addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request))
})
```

## Cloudflare Worker adapter

```ts
import { handleRequest } from './shared'

export default {
  fetch(request: Request, env: Record<string, string>) {
    return handleRequest(request, env)
  },
}
```

## Node.js adapter (>=22.12.0)

```ts
import { createServer } from 'node:http'
import { handleRequest } from './shared'

const server = createServer(async (req, res) => {
  const request = new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
  })
  const response = await handleRequest(request, process.env)
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(await response.text())
})

server.listen(3000)
```

## Common pitfalls

- Passing Node `IncomingMessage` directly into the shared handler.
- Assuming `process.env` exists in Workers.
- Using `Buffer` in shared logic without guards.
- Relying on `window` or DOM APIs for parsing URLs or storage.
