# Mokup plugin examples

`storage.mjs` shows the smallest plugin that owns a storage resource and
installs a route. The resource value stays inside the plugin host; diagnostics
and Devframe only receive its `kind`, `name`, and plugin name.

The example uses `createMockSession` so it can run in Node, Worker tests, or a
custom adapter. In an application, pass the same handlers to `setupServer`, a
Fetch handler, or a framework adapter and keep the plugin host in the same
lifecycle scope.
