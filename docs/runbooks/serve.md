---
title: "Runbook: Serve"
description: "Operational runbook for personaforge/serve — import, run, verify, recover. 161 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Serve

> Auto-generated from `./dist/serve.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/serve`  ·  **Public symbols:** 161  ·  **Guide:** [/guide/websocket](../guide/websocket.md)

## What it is
`personaforge/serve` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createAuthMiddleware, apiKeyAuth, bearerAuth } from 'personaforge/serve';
```

## Public API surface
- **Factories / functions** — `createAuthMiddleware`, `apiKeyAuth`, `bearerAuth`, `createHttpService`, `listenService`, `getRuntimeOpenApiJson`, `verifyJwtHs256`, `verifyJwtAsymmetric`, `hasRole`, `jwtAuth`, `attachWebSocketTransport`
- **Interfaces** — `SessionRow`, `MemoryRow`, `LearningRow`, `KnowledgeRow`, `TraceRow`, `ScheduleRow`, `SessionQuery`, `MemoryQuery`, `LearningQuery`, `KnowledgeQuery`, `UpsertSessionInput`, `UpsertMemoryInput`, …(+121)
- **Types** — `LearningType`, `EntityId`, `MessageContent`, `ContentPart`, `AdapterCategory`, `SqlRow`, `VectorMetric`, `AnalyticsExportFormat`, `EmbeddingFn`, `IdempotencyState`, `ApprovalStatus`, `ComponentType`, …(+5)

## Minimal use
```ts
import { createAuthMiddleware, apiKeyAuth, bearerAuth } from 'personaforge/serve';

// `createAuthMiddleware` is the primary entry for this feature.
// See the type signature for full options.
const result = createAuthMiddleware(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/serve` with no missing-module error.
- Runtime: `node -e "import('personaforge/serve').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/websocket](../guide/websocket.md).

## Common failures
- `Cannot find module 'personaforge/serve'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/websocket](../guide/websocket.md)
