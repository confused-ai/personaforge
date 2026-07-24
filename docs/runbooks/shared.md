---
title: "Runbook: Shared"
description: "Operational runbook for personaforge/shared — import, run, verify, recover. 21 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Shared

> Auto-generated from `./dist/shared.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/shared`  ·  **Public symbols:** 21  ·  **Guide:** [/guide/getting-started](../guide/getting-started.md)

## What it is
`personaforge/shared` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createDebugLogger, recordFrameworkStartup, isTelemetryEnabled } from 'personaforge/shared';
```

## Public API surface
- **Factories / functions** — `createDebugLogger`, `recordFrameworkStartup`, `isTelemetryEnabled`, `tryImport`
- **Classes** — `AgentError`, `LLMError`, `ToolExecutionError`, `GuardrailError`, `TimeoutError`, `CancellationError`, `ConfigError`, `SessionError`, `PermissionError`, `ToolNotAuthorizedError`, `DebugLogger`
- **Constants** — `ErrorCode`, `VERSION`
- **Interfaces** — `LogContext`, `Logger`, `DebugLoggerConfig`
- **Types** — `ErrorCodeType`

## Minimal use
```ts
import { createDebugLogger, recordFrameworkStartup, isTelemetryEnabled } from 'personaforge/shared';

// `createDebugLogger` is the primary entry for this feature.
// See the type signature for full options.
const result = createDebugLogger(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/shared` with no missing-module error.
- Runtime: `node -e "import('personaforge/shared').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/getting-started](../guide/getting-started.md).

## Common failures
- `Cannot find module 'personaforge/shared'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/getting-started](../guide/getting-started.md)
