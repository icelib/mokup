# @mokup/shared

Shared utilities and public helper exports used across Mokup packages.

## Highlights

- Shared diagnostics helpers for route-scan and service worker conflict reporting.
- Shared filesystem, path, config, and module-loader helpers.
- The shared `rolldown` wrapper used by Mokup build tooling.

## Diagnostics helpers

```ts
import {
  collectRouteDiagnosticWarning,
  createRouteDiagnosticSections,
  reportDiagnostics,
} from '@mokup/shared/diagnostics'

const unsupportedFields = new Set<string>()
const missingHandlers = new Set<string>()
const duplicateRoutes = new Set<string>()

collectRouteDiagnosticWarning({
  message: 'Skip mock without handler: mock/users.get.ts',
  onUnsupportedFields: value => unsupportedFields.add(value),
  onMissingHandler: value => missingHandlers.add(value),
  onDuplicateRoute: value => duplicateRoutes.add(value),
})

const sections = createRouteDiagnosticSections({
  unsupportedFields: [...unsupportedFields],
  missingHandlers: [...missingHandlers],
  duplicateRoutes: [...duplicateRoutes],
})

const { error, summaryLines } = reportDiagnostics({
  sections,
  errorOn: ['missing-handler'],
})
```

For service worker diagnostics, reuse
`collectSwConflictDiagnosticWarning(...)` and
`createSwConflictDiagnosticSections(...)`.

## Common entries

- `@mokup/shared`
- `@mokup/shared/diagnostics`
- `@mokup/shared/rolldown`
- `@mokup/shared/logger`
- `@mokup/shared/module-loader`
- `@mokup/shared/pathe`

## Node.js

- `>=22.12.0`
