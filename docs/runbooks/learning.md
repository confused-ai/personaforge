---
title: "Runbook: Learning"
description: "Operational runbook for personaforge/learning — import, run, verify, recover. 77 public symbols."
outline: [2, 3]
generated: true
---

# Runbook: Learning

> Auto-generated from `./dist/learning.d.ts`. Do not edit by hand — run `node scripts/gen-runbooks.mjs`.

**Import path:** `personaforge/learning`  ·  **Public symbols:** 77  ·  **Guide:** [/guide/learning-machine](../guide/learning-machine.md)

## What it is
`personaforge/learning` is a public entry point of personaforge. Import it directly; you only pull in this feature's code (subpath exports are tree-shakeable and optional native deps load lazily).

## Install
```bash
npm i personaforge
# or: bun add personaforge · pnpm add personaforge · yarn add personaforge
```

## Import
```ts
import { createSqliteUserProfileStore, InMemoryUserProfileStore, SqliteUserProfileStore } from 'personaforge/learning';
```

## Public API surface
- **Factories / functions** — `createSqliteUserProfileStore`
- **Classes** — `InMemoryUserProfileStore`, `SqliteUserProfileStore`, `Curator`, `LearningMachine`, `InMemoryUserMemoryStore`, `InMemorySessionContextStore`, `InMemoryLearnedKnowledgeStore`, `InMemoryEntityMemoryStore`, `InMemoryDecisionLogStore`, `SqliteUserMemoryStore`, `SqliteSessionContextStore`, `SqliteLearnedKnowledgeStore`, …(+17)
- **Enums** — `LearningMode`
- **Interfaces** — `SessionRow`, `MemoryRow`, `LearningRow`, `KnowledgeRow`, `TraceRow`, `ScheduleRow`, `SessionQuery`, `MemoryQuery`, `LearningQuery`, `KnowledgeQuery`, `UpsertSessionInput`, `UpsertMemoryInput`, …(+30)
- **Types** — `LearningType`, `EntityId`, `LearningTool`, `PgLearningStoreConfig`

## Minimal use
```ts
import { createSqliteUserProfileStore, InMemoryUserProfileStore, SqliteUserProfileStore } from 'personaforge/learning';

// `createSqliteUserProfileStore` is the primary entry for this feature.
// See the type signature for full options.
const result = createSqliteUserProfileStore(/* opts */);
```

## Verify it works
- Type-check: `npx tsc --noEmit` resolves `personaforge/learning` with no missing-module error.
- Runtime: `node -e "import('personaforge/learning').then(m => console.log(Object.keys(m)))"` lists the exports above.
- Behavior: follow the runnable example in [/guide/learning-machine](../guide/learning-machine.md).

## Common failures
- `Cannot find module 'personaforge/learning'` — package not installed or stale build; run `npm i personaforge` and rebuild.
- `Cannot find module '<peer>'` at call time — this feature lazy-loads an optional native/SDK dep; install the one named in the error.
- Type errors after upgrade — check `CHANGELOG.md` for the symbol you import; names above are the current contract.

## Rollback
- Remove the import and the feature is gone from your bundle (subpaths are isolated; nothing else depends on importing it).
- Pin a known-good version: `npm i personaforge@<version>`.

## Related
- Full index: [/runbooks/](./index.md) · [llms.txt](../llms.txt)
- Concept guide: [/guide/learning-machine](../guide/learning-machine.md)
