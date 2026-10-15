# File Routing

Mokup turns file paths into routes. Key rules:

## Method suffix

Files must include an HTTP method suffix (`.get`, `.post`, etc.):

```
mock/users.get.json   -> GET /users
mock/users.post.ts    -> POST /users
```

In the Vite plugin, `.json/.jsonc` files default to `GET` if no suffix is present. For CLI builds, an explicit suffix is recommended.

## REST methods at a glance

Common RESTful routes map directly to file names:

```
mock/items/index.get.ts       -> GET    /items
mock/items/index.post.ts      -> POST   /items
mock/items/[id].get.ts        -> GET    /items/:id
mock/items/[id].put.ts        -> PUT    /items/:id
mock/items/[id].patch.ts      -> PATCH  /items/:id
mock/items/[id].delete.ts     -> DELETE /items/:id
```

## index routes

`index` maps to the directory root:

```
mock/index.get.json       -> GET /
mock/users/index.get.ts   -> GET /users
```

## Dynamic params

Use brackets:

```
mock/users/[id].get.ts    -> GET /users/:id
mock/[action]/[id].get.ts -> GET /:action/:id
```

Access via `c.req.param('id')`:

Parameter names may contain letters, digits, underscores, and hyphens, including names such as `[123]` and `[user-id]`. Use the original name when calling `c.req.param()`. Duplicate names produce a warning; the last occurrence supplies the value.

Static segments are literal: `:fixed`, `*`, `ab{2}`, and `a|b` do not introduce parameters, wildcards, or regular expressions. File names must also be valid on your operating system.

```ts
export default {
  handler: c => ({ id: c.req.param('id') }),
}
```

Tip: you can wrap route exports with `defineHandler` for better IntelliSense:

```ts
import { defineHandler } from 'mokup'

export default defineHandler({
  handler: c => ({ id: c.req.param('id') }),
})
```

You can return all params in one shot:

```ts
import { defineHandler } from 'mokup'

export default defineHandler(c => ({
  params: c.req.param(),
}))
```

## Catch-all and optional segments

```
mock/docs/[...slug].get.ts   -> /docs/* (at least 1 segment)
mock/docs/[[...slug]].get.ts -> /docs (optional)
```

`c.req.param('slug')` returns a slash-separated string for a catch-all, or `undefined` when an optional catch-all is absent. An absent optional catch-all also clears an earlier parameter with the same name.

## JSON and JSONC routes

JSON files work as static handlers:

```
mock/status.get.json  -> GET /status
```

JSONC supports comments and trailing commas:

```
mock/summary.get.jsonc -> GET /summary
```

Dynamic params also work with JSON routes:

```
mock/[action]/[id].get.json -> GET /:action/:id
```

## Multi-rule files

A file can export an array of rules. Disabled entries are skipped, enabled ones apply:

```ts
import type { RouteRule } from 'mokup'

const rules: RouteRule[] = [
  { enabled: false, handler: () => ({ variant: 'disabled' }) },
  { handler: () => ({ variant: 'active' }) },
]

export default rules
```

## Disabled routes

Disable a route by setting `enabled: false`:

```ts
import { defineHandler } from 'mokup'

export default defineHandler({
  enabled: false,
  handler: () => ({ ok: false }),
})
```

## Directory config (defineConfig)

Use `index.config.ts` to define per-folder config, headers, delays, and middleware:

```ts
import { defineConfig, onAfterAll, onBeforeAll } from 'mokup'

export default defineConfig(({ app }) => {
  onBeforeAll(() => {
    app.use(async (c, next) => {
      c.header('x-mokup-pre', '1')
      await next()
    })
  })

  onAfterAll(() => {
    app.use(async (c, next) => {
      await next()
      c.header('x-mokup-post', '1')
    })
  })

  return {
    delay: 20,
    headers: { 'x-mokup-demo': 'file-routing' },
  }
})
```

## Ignored files

Unsupported extensions (like `.txt`) are ignored. By default, any path segment
starting with `.` is ignored:

```
mock/notes.txt            -> ignored
mock/.draft/notes.get.ts  -> ignored by default (.)
mock/.ignored/skip.get.ts -> ignored by default (.)
```

You can override the ignore list via `ignorePrefix` (string or array). Setting it
replaces the default list, so include `.` if you still want dot segments ignored:

```ts
// mock/index.config.ts
export default {
  ignorePrefix: ['.', 'draft-'],
}
```

```
mock/draft-legacy/skip.get.ts -> ignored when ignorePrefix includes "draft-"
```
