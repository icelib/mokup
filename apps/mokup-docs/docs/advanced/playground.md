# Playground

Playground is a built-in UI for browsing and debugging mock APIs.

## Default entry

```
http://localhost:5173/__mokup
```

## Configure path

```ts
import mokup from 'mokup/vite'

export default {
  plugins: [
    mokup({
      entries: {
        dir: 'mock',
        prefix: '/api',
      },
      playground: {
        path: '/__mokup',
        enabled: true,
      },
    }),
  ],
}
```

Set `playground: false` to disable it.

For static builds, set `playground.build: true` so `vite build` emits the
Playground assets and `/__mokup/routes` JSON under the configured path.

## Features

- Grouped route listing
- Request method/path inspection
- Live refresh on file changes
- Copy requests as cURL commands or Fetch code, including query parameters, authentication, headers, and text request bodies

## Copy a request

Select a route, configure the request, and use **Copy → Copy cURL** or **Copy → Copy fetch**. Both formats use the Playground's current host and port. Raw text, URL-encoded fields, and multipart text fields retain their values; raw text beginning with `@` remains text in the cURL command.

cURL commands use POSIX shell quoting, suitable for Bash, Zsh, or Git Bash. File selections are not included in copied snippets; attach those separately in the destination client.
